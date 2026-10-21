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

const NOTIFY_DEBOUNCE_MS = 50;

const STALE_AFTER_MS = 10_000;

/**
 * Без постоянного рекурсивного watcher'а — он морил цикл рендера и ввода; свежесть —
 * `refreshIfStale()` при открытии Quick Open, новый файл может появиться с задержкой.
 */
export class FileSearchService extends Disposable implements IFileSearchService {
    public static dependencies = [IConfigurationServiceDIToken] as const;

    private entries: FileSearchEntry[] = [];
    private rootPath: string | null = null;

    public isIndexed = false;

    private readonly onIndexChangedEmitter = new Emitter<void>();
    public readonly onIndexChanged = this.onIndexChangedEmitter.event;

    private isDisposedLocal = false;
    private walkGeneration = 0;
    private indexing = false;
    private lastIndexedAt = 0;
    private readyPromise: Promise<void> = Promise.resolve();
    private notifyTimer: ReturnType<typeof setTimeout> | null = null;
    private walker: GuardedChildProcess | null = null;
    private resolvedRgPath: string | null;

    /**
     * Индекс режет и `files.exclude`, и `search.exclude` (`searchExcludeGlobs`); правка
     * настроек пересобирает его сразу — иначе исключённое висело бы до перезапуска.
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

    public get ready(): Promise<void> {
        return this.readyPromise;
    }

    public activate(rootPath: string): Promise<void> {
        this.rootPath = rootPath;
        this.readyPromise = this.startIndexing();
        return this.readyPromise;
    }

    public refreshIfStale(): void {
        if (this.rootPath === null || this.isDisposedLocal) return;
        if (this.indexing) return;
        if (Date.now() - this.lastIndexedAt < STALE_AFTER_MS) return;
        this.readyPromise = this.startIndexing();
    }

    public search(query: string, maxResults = 50): FileSearchResult[] {
        // Prepared once per keystroke, never per index entry.
        const prepared = prepareQuery(query);
        if (prepared.terms.length === 0) {
            return this.entries.slice(0, maxResults).map((entry) => ({
                entry,
                score: 0,
                matchedIndices: [],
            }));
        }

        const results: FileSearchResult[] = [];
        // A fuzzy match needs every query char, and the path mask covers the basename too:
        // one integer AND rejects the entry for both match paths.
        const queryBits = prepared.bits;

        for (const entry of this.entries) {
            if ((entry.relativePathBits & queryBits) !== queryBits) continue;

            const basenameMatch =
                (entry.basenameBits & queryBits) === queryBits
                    ? fuzzyMatchPreparedLower(prepared, entry.basename, entry.basenameLower)
                    : null;
            if (basenameMatch !== null) {
                const offset = entry.relativePath.length - entry.basename.length;
                results.push({
                    entry,
                    score: basenameMatch.score + BASENAME_BONUS,
                    matchedIndices: basenameMatch.matchedIndices.map((i) => i + offset),
                });
                continue;
            }

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

    private startIndexing(): Promise<void> {
        // Окно без папки сюда тоже попадает (правка `files.exclude`), но обходить там нечего.
        if (this.rootPath === null) return Promise.resolve();
        const root = this.rootPath;
        const generation = ++this.walkGeneration;
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
     * `rg --files`, как у эталона: rg уважает ignore-файлы и режет исключённые ветки до
     * спуска в них. Вывод разбирается по мере прихода — индекс растёт вживую.
     */
    private walk(root: string, generation: number): Promise<void> {
        if (this.cancelled(generation)) return Promise.resolve();
        const next: FileSearchEntry[] = [];
        // Initial build publishes `next` live; a refresh swaps at the end to avoid
        // flickering through a partial list.
        const live = this.entries.length === 0;
        if (live) this.entries = next;

        // Настройки — одни на обход: их правка всё равно пересобирает индекс целиком.
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
     * `kill`, а не `dispose` guard'а: dispose гасит и `onDidEnd`, и `ready` не дорешился бы.
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

    /** Case-folds up front so `search()` allocates no strings per keystroke. */
    private makeEntry(rootPath: string, absPath: string, basename: string): FileSearchEntry {
        const rel = path.relative(rootPath, absPath);
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
