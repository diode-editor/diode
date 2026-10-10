import { spawn } from "node:child_process";
import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { charMask, fuzzyMatchPreparedLower, prepareQuery } from "../../../../base/common/fuzzySearch.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { GuardedChildProcess, splitLines } from "../../../../base/node/childProcessGuard.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import {
    FILES_EXCLUDE_SETTING,
    readUseIgnoreFiles,
    SEARCH_EXCLUDE_SETTING,
    SEARCH_IGNORE_FILES_SETTINGS,
    searchExcludeGlobs,
} from "../../../common/configuration/excludeSettings.ts";
import {
    BASENAME_BONUS,
    type FileSearchEntry,
    type FileSearchResult,
    type IFileSearchService,
} from "../common/fileSearch.ts";
import { buildRgFilesArgs } from "../common/ripgrepArgs.ts";

import { loadRipgrepPath } from "./loadRipgrep.ts";

/** Debounce for onIndexChanged so a background walk does not spam subscribers. */
const NOTIFY_DEBOUNCE_MS = 50;

/** Skip an on-demand re-walk if the index was rebuilt more recently than this. */
const STALE_AFTER_MS = 10_000;

/**
 * In-memory file index for Quick Open.
 *
 * The index is built **in the background** from `rg --files` output, parsed as
 * it streams in, so the editor stays responsive even on huge trees. There is no
 * always-on recursive filesystem watcher (it used to starve the render/input
 * loop); freshness is best-effort via `refreshIfStale()` (called when Quick Open
 * opens). A just-created file may therefore appear with a small delay.
 */
export class FileSearchService extends Disposable implements IFileSearchService {
    public static dependencies = [IConfigurationServiceDIToken] as const;

    private entries: FileSearchEntry[] = [];
    private rootPath: string | null = null;

    /** True once an initial background walk has fully completed. */
    public isIndexed = false;

    private readonly onIndexChangedEmitter = new Emitter<void>();
    /** Fired (debounced) as the index grows or changes. */
    public readonly onIndexChanged = this.onIndexChangedEmitter.event;

    private isDisposedLocal = false;
    /** Bumped on every walk; an in-flight walk bails when it sees a newer one. */
    private walkGeneration = 0;
    private indexing = false;
    private lastIndexedAt = 0;
    private readyPromise: Promise<void> = Promise.resolve();
    private notifyTimer: ReturnType<typeof setTimeout> | null = null;
    /** Идущий `rg --files`; снимается, когда его обход отменён. */
    private walker: GuardedChildProcess | null = null;
    private resolvedRgPath: string | null;

    /**
     * @param configurationService Источник `files.exclude`/`search.exclude` —
     * индекс режет по обоим наборам (поиск по именам файлов это ПОИСК, см.
     * `searchExcludeGlobs`) — и `search.useIgnoreFiles` с соседями. Настройки
     * читаются на каждый обход, а их правка пересобирает индекс сразу: иначе
     * исключённое висело бы в Quick Open до перезапуска.
     * @param ripgrepPath Явный путь к `rg` (тесты). В проде не передаётся —
     * резолвится лениво через {@link loadRipgrepPath}.
     */
    public constructor(
        private readonly configurationService: IConfigurationService,
        ripgrepPath?: string,
    ) {
        super();
        this.resolvedRgPath = ripgrepPath ?? null;
        const affecting = [FILES_EXCLUDE_SETTING, SEARCH_EXCLUDE_SETTING, ...SEARCH_IGNORE_FILES_SETTINGS];
        this.register(
            configurationService.onDidChangeConfiguration((event) => {
                if (!affecting.some((key) => event.affectsConfiguration(key))) return;
                if (this.isDisposedLocal) return;
                // Снимаем throttle: индекс устарел по содержанию, а не по
                // времени. Окно без папки отсеет сам `startIndexing`.
                this.lastIndexedAt = 0;
                this.readyPromise = this.startIndexing();
            }),
        );
    }

    /** Resolves when the current (initial) background walk completes. */
    public get ready(): Promise<void> {
        return this.readyPromise;
    }

    /** Point the index at `rootPath` and start building it in the background. */
    public activate(rootPath: string): Promise<void> {
        this.rootPath = rootPath;
        this.readyPromise = this.startIndexing();
        return this.readyPromise;
    }

    /**
     * Rebuild the index in the background if it is stale and not already being
     * built. Cheap to call on every Quick Open; throttled internally.
     */
    public refreshIfStale(): void {
        if (this.rootPath === null || this.isDisposedLocal) return;
        if (this.indexing) return;
        if (Date.now() - this.lastIndexedAt < STALE_AFTER_MS) return;
        this.readyPromise = this.startIndexing();
    }

    /**
     * Search the index for files matching `query`. Works on a partial index
     * while a background walk is still in progress.
     *
     * - Empty query (or whitespace only): returns first `maxResults` entries
     *   with score 0.
     * - Non-empty query: tries fuzzy match on the basename first (with bonus),
     *   falls back to matching the full relative path. Sorted by score desc.
     *
     * A query is split into space-separated terms, all of which must match
     * (`prepareQuery`) — `src other` finds `src/.../other.ts`.
     */
    public search(query: string, maxResults = 50): FileSearchResult[] {
        // Parse the query once per keystroke, before the loop over the index:
        // lowercasing, the term split and the char mask must not repeat per
        // entry (that is the whole point of the prepared query / `*Lower` API).
        const prepared = prepareQuery(query);
        if (prepared.terms.length === 0) {
            return this.entries.slice(0, maxResults).map((entry) => ({
                entry,
                score: 0,
                matchedIndices: [],
            }));
        }

        const results: FileSearchResult[] = [];
        // Char-presence mask of the query, computed once by `prepareQuery`. A
        // fuzzy match needs every query char present in the text, so an entry
        // whose path lacks any of them cannot match at all — reject it with one
        // integer AND before touching the matcher. The path mask covers the
        // basename too (the path contains it), so it is the necessary condition
        // for either match path.
        const queryBits = prepared.bits;

        for (const entry of this.entries) {
            // Cheap reject: path lacks some query char → neither basename nor
            // path can match. Skips the expensive matcher for most entries.
            if ((entry.relativePathBits & queryBits) !== queryBits) continue;

            // First try matching against the basename only, but only when the
            // basename itself could contain every query char.
            const basenameMatch =
                (entry.basenameBits & queryBits) === queryBits
                    ? fuzzyMatchPreparedLower(prepared, entry.basename, entry.basenameLower)
                    : null;
            if (basenameMatch !== null) {
                // Re-map indices from basename space to relativePath space
                const offset = entry.relativePath.length - entry.basename.length;
                results.push({
                    entry,
                    score: basenameMatch.score + BASENAME_BONUS,
                    matchedIndices: basenameMatch.matchedIndices.map((i) => i + offset),
                });
                continue;
            }

            // Fall back to matching against the full relative path
            const pathMatch = fuzzyMatchPreparedLower(prepared, entry.relativePath, entry.relativePathLower);
            if (pathMatch !== null) {
                results.push({
                    entry,
                    score: pathMatch.score,
                    matchedIndices: pathMatch.matchedIndices,
                });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, maxResults);
    }

    public override dispose(): void {
        this.isDisposedLocal = true;
        this.killWalker();
        if (this.notifyTimer !== null) {
            clearTimeout(this.notifyTimer);
            this.notifyTimer = null;
        }
        super.dispose();
    }

    // ─── Private: background indexing ─────────────────────────────────────────

    private startIndexing(): Promise<void> {
        // Окна без папки воркспейса достаточно: правка `files.exclude` прилетает
        // и туда, а обходить там нечего (ветка живая, см. тест «правка до
        // activate() обхода не запускает»).
        if (this.rootPath === null) return Promise.resolve();
        const root = this.rootPath;
        const generation = ++this.walkGeneration;
        // Вывод прежнего обхода уже никому не нужен — снимаем его rg сразу.
        this.killWalker();
        this.indexing = true;
        this.isIndexed = false;

        // Defer the walk so app.run()/the first render happen before it starts
        // consuming the event loop.
        return new Promise<void>((resolve) => setImmediate(resolve))
            .then(() => this.walk(root, generation))
            .catch(() => {
                /* rg не загрузился (битый ассет сборки) — индекс пуст, редактор жив */
            })
            .finally(() => {
                if (generation === this.walkGeneration) this.indexing = false;
            });
    }

    /**
     * Список файлов — `rg --files`, как у эталона (`ripgrepFileSearch.ts`):
     * ripgrep уважает ignore-файлы (`search.useIgnoreFiles` и соседи) и режет
     * исключённые ветки до спуска в них. Свой обход ФС ignore-файлов не знал —
     * в Quick Open ехало всё, что игнорирует git. Вывод разбирается построчно по
     * мере прихода: индекс растёт вживую, цикл событий между кусками stdout
     * свободен.
     */
    private walk(root: string, generation: number): Promise<void> {
        if (this.cancelled(generation)) return Promise.resolve();
        const next: FileSearchEntry[] = [];
        // When the index is empty (initial build) publish `next` immediately so
        // results grow live. On a refresh keep the old list and swap at the end
        // to avoid flicker through a partial/empty state.
        const live = this.entries.length === 0;
        if (live) this.entries = next;

        // Настройки — одни на обход: правка любой из них пересобирает индекс
        // целиком (см. конструктор), а половина обхода по старому набору была
        // бы хуже.
        const args = buildRgFilesArgs(
            searchExcludeGlobs(this.configurationService),
            readUseIgnoreFiles(this.configurationService),
        );
        const child = spawn(this.rgPath(), args, { cwd: root });
        // Конец — по `close`: после `exit` в stdout ещё могут оставаться строки.
        // Stryker disable next-line StringLiteral: логгера у сервиса нет — метка в лог не попадает
        const guard = new GuardedChildProcess(child, { label: "rg", waitForStdio: true });
        this.walker = guard;

        splitLines(child.stdout, (line) => {
            if (this.cancelled(generation)) return;
            const absPath = path.join(root, line);
            next.push(this.makeEntry(root, absPath, path.basename(absPath)));
            this.scheduleNotify();
        });

        return new Promise<void>((resolve) => {
            guard.onDidEnd(() => {
                // `walker` не обнуляем: `kill` вышедшему безвреден (см. killWalker).
                // Код выхода не смотрим: 1 — «файлов нет», 2 — rg упёрся в
                // нечитаемый каталог, но остальное перечислил; несуществующий
                // корень (`error` спавна) — пустой индекс, а не отказ.
                if (!this.cancelled(generation)) {
                    // При живом наполнении `entries` уже и есть `next`.
                    this.entries = next;
                    this.isIndexed = true;
                    this.lastIndexedAt = Date.now();
                    this.flushNotify();
                }
                resolve();
            });
        });
    }

    /**
     * Снимает идущий `rg --files` (уже вышедшему — безвредно). `kill`, а не
     * `dispose` guard'а: dispose гасит и `onDidEnd`, и промис обхода (а с ним
     * `ready`) не дорешился бы никогда.
     */
    private killWalker(): void {
        this.walker?.child.kill();
        this.walker = null;
    }

    private rgPath(): string {
        this.resolvedRgPath ??= loadRipgrepPath();
        return this.resolvedRgPath;
    }

    private cancelled(generation: number): boolean {
        return this.isDisposedLocal || generation !== this.walkGeneration;
    }

    private scheduleNotify(): void {
        if (this.notifyTimer !== null) return;
        this.notifyTimer = setTimeout(() => {
            this.notifyTimer = null;
            this.onIndexChangedEmitter.fire();
        }, NOTIFY_DEBOUNCE_MS);
    }

    private flushNotify(): void {
        if (this.notifyTimer !== null) {
            clearTimeout(this.notifyTimer);
            this.notifyTimer = null;
        }
        this.onIndexChangedEmitter.fire();
    }

    /**
     * Builds a {@link FileSearchEntry}, pre-computing the case-folded basename and
     * relative path so `search()` does zero string allocation per keystroke.
     */
    private makeEntry(rootPath: string, absPath: string, basename: string): FileSearchEntry {
        const rel = path.relative(rootPath, absPath);
        // Normalise to forward slashes on all platforms
        const relativePath = rel.split(path.sep).join("/");
        const basenameLower = basename.toLowerCase();
        const relativePathLower = relativePath.toLowerCase();
        return {
            relativePath,
            absolutePath: absPath,
            basename,
            basenameLower,
            relativePathLower,
            basenameBits: charMask(basenameLower),
            relativePathBits: charMask(relativePathLower),
        };
    }
}
