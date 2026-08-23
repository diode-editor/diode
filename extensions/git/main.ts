import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import type { IDotGit } from "./lib/dotGit.ts";
import { parseDotGit, refsRoot, upstreamRefPath } from "./lib/dotGit.ts";
import { showFileAtRevision, toRepoRelativePath } from "./lib/gitShow.ts";
import { fromGitUri, GIT_SCHEME, ORIGINAL_RESOURCE_COMMAND, toGitUri } from "./lib/gitUri.ts";
import type { IStatusDecoration } from "./lib/map.ts";
import { statusToDecoration, xyToResourceStates } from "./lib/map.ts";
import { parsePorcelainStatus } from "./lib/porcelain.ts";
import { LOG_FORMAT_ARGS, parseLogZ } from "./lib/logParse.ts";
import type { GitOpResult, IGitCommitParams } from "./lib/protocol.ts";
import { GIT_OP_COMMAND } from "./lib/protocol.ts";
import {
    branchCreateArgs,
    branchDeleteArgs,
    branchRenameArgs,
    checkoutArgs,
    cherryPickArgs,
    mergeArgs,
    pushDeleteArgs,
    rebaseArgs,
} from "./lib/branchArgs.ts";
import { classifyGitStderr } from "./lib/classifyGitError.ts";
import { FOR_EACH_REF_FORMAT, parseForEachRefZ, parseStashListZ, STASH_LIST_FORMAT } from "./lib/queryParse.ts";
import type { IRepoStatePayload } from "./lib/repoState.ts";
import { parseBranchHeaders, parseRemotes } from "./lib/repoState.ts";
import { remoteAddArgs, remoteRemoveArgs, tagCreateArgs, tagDeleteArgs } from "./lib/remoteArgs.ts";
import { resetArgs, revertArgs } from "./lib/resetArgs.ts";
import { stashApplyArgs, stashDropArgs, stashPopArgs, stashPushArgs } from "./lib/stashArgs.ts";
import { fetchArgs, pullArgs, pushArgs } from "./lib/syncArgs.ts";
import { isRelevantDotGitEvent, isRelevantWorkingTreeEvent } from "./lib/watch.ts";
import type { IRunGitError, IRunGitOptions, IRunGitResult } from "./lib/runGit.ts";
import { runGit } from "./lib/runGit.ts";

/**
 * Built-in Git plugin (subprocess extension, plugin-API only).
 *
 * Two features:
 *  - explorer: changed files are coloured + badged via a `FileDecorationProvider`;
 *  - editor: the HEAD version of a file is served over the `git:` scheme through a
 *    read-only `FileSystemProvider`, so the core can diff it against the live
 *    buffer itself (gutter change-bars). Раньше ханки считало само расширение по
 *    файлу на диске — из-за этого бары залипали до сохранения.
 *
 * Reliability is the point: every `git` call goes through {@link runGit} (which
 * never rejects), every event handler is wrapped, refreshes are debounced, and
 * any bad environment (no workspace, no repo, missing binary, non-zero exit)
 * degrades to "no decorations" plus a single log line — nothing escapes to the host.
 */

function log(message: string): void {
    // stdout of the subprocess is piped into the `extensions.host.stdout` log
    // channel (→ ./diode.log in dev); it never touches the TUI pty.
    console.log(`[git] ${message}`);
}

/**
 * Команда ядра, которой мы публикуем полный набор изменённых файлов (вкладка
 * Changes). Ядро её регистрирует (`ScmChangesService`); строка совпадает по
 * значению, как и у `ORIGINAL_RESOURCE_COMMAND` — модули по разные стороны
 * границы процесса общих импортов не имеют.
 */
const PUBLISH_CHANGES_COMMAND = "diode.scm.publishChanges";

/**
 * Команда ядра, которой мы публикуем последние коммиты (view Graph). Ядро её
 * регистрирует (`ScmGraphService`); строка дублируется по значению — общих
 * импортов через границу процесса нет.
 */
const PUBLISH_LOG_COMMAND = "diode.scm.publishLog";
/**
 * Ядро отвечает, раскрыта ли секция GRAPH. Пока не раскрыта — история никому
 * не нужна, и `git log` мы не запускаем вовсе. Спрашиваем один раз при
 * активации; дальше ядро само присылает изменения операцией `logSetEnabled`.
 */
const GRAPH_ENABLED_COMMAND = "diode.scm.graphEnabled";

/**
 * Команда ядра для снимка состояния репозитория (ветка/upstream/ahead-behind/
 * remotes/merge-rebase). Ядро регистрирует (`ScmRepoStateService`) и деривирует
 * when-ключи git*-команд.
 */
const PUBLISH_REPO_STATE_COMMAND = "diode.scm.publishRepoState";

/** Read-only запрос данных для пикеров ядра: refs / stashes / remotes. */
const QUERY_COMMAND = "diode.git.query";

/**
 * Страница истории для view Graph — сколько коммитов публикуем за раз. Как в
 * vscode: дефолт 50, настройка `scm.graph.pageSize`, потолок 1000; дальше
 * история догружается по «Load More» (операция `logLoadMore`).
 */
const LOG_PAGE_SIZE_DEFAULT = 50;
const LOG_PAGE_SIZE_MAX = 1000;

/**
 * Команды-транспорты мутаций staging (регистрируем мы, зовёт ядро; user-facing
 * `git.*`-команды живут в ядре — одноимённая регистрация перезаписала бы их в
 * CommandRegistry). Аргумент — массив строк-uri; результат — {@link IGitMutationResult}.
 */
const STAGE_COMMAND = "diode.git.stage";
const UNSTAGE_COMMAND = "diode.git.unstage";
const CLEAN_COMMAND = "diode.git.clean";

/** Результат мутации, уходящий в ядро по возвратному каналу RPC. */
interface IGitMutationResult {
    readonly ok: boolean;
    /** Первая строка stderr — при `ok: false`. */
    readonly message?: string;
}

/** A tracked resource: its porcelain code (for untracked detection) + tree decoration. */
interface IStatusEntry {
    readonly xy: string;
    /** Путь относительно корня репозитория (из porcelain, всегда через `/`). */
    readonly relPath: string;
    readonly deco: IStatusDecoration;
}

class GitDecorations {
    private readonly repoRoot: string;
    /** Служебный каталог репозитория — не обязательно `<root>/.git` (worktree/submodule). */
    private readonly dotGit: IDotGit;
    private readonly gitEnv: NodeJS.ProcessEnv | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    // Tree status, keyed by absolute path. Drives both the file-decoration
    // provider.
    private status = new Map<string, IStatusEntry>();
    private readonly fileDecoEmitter = new vscode.EventEmitter<vscode.Uri[]>();
    /** Сообщает ядру, что версии в `git:`-ресурсах изменились (сдвинулся HEAD/индекс). */
    private readonly fileChangeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    /** Ставится при регистрации провайдера; зовётся из watcher'а `.git`. */
    private onGitDirChanged: (() => void) | undefined;

    /**
     * Сколько коммитов сейчас показывает граф; 0 — «страница по умолчанию»
     * (значение настройки). Растёт по операции `logLoadMore`.
     */
    private logLimit = 0;
    /**
     * Нужна ли графу история. Дефолт — «нужна»: до ответа ядра ведём себя
     * по-старому, иначе ядро без этого канала осталось бы с пустым графом
     * навсегда. Настоящее значение приезжает в {@link pullGraphEnabled}.
     */
    private logEnabled = true;
    /** Upstream текущей ветки — второй ref истории графа (режим `auto` vscode). */
    private upstreamRef: string | null = null;

    private refreshTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Сколько мутаций сейчас в полёте. Пока она не ноль, файловые события
     * рефреш не запускают: `git status` дрался бы за `.git/index.lock` с
     * операцией пользователя, а сама операция закончится своим refreshAll.
     */
    private pendingMutations = 0;
    /**
     * Watcher ref'а upstream'а — transient: пересоздаётся на каждый снимок
     * состояния, потому что upstream меняется вместе с веткой.
     */
    private upstreamWatcher: vscode.Disposable | undefined;
    private upstreamWatchedRef: string | null = null;
    #disposed = false;
    // Метод, а не поле/геттер: результат вызова TS не сужает, поэтому повторные проверки
    // после await не «залипают» (флаг может стать true во время асинхронной паузы).
    private isDisposed(): boolean {
        return this.#disposed;
    }

    // Whether we already logged a degraded git invocation this session (avoid spam).
    private loggedGitFailure = false;

    public constructor(repoRoot: string, dotGit: IDotGit, gitEnv: NodeJS.ProcessEnv | undefined) {
        this.repoRoot = repoRoot;
        this.dotGit = dotGit;
        this.gitEnv = gitEnv;
    }

    /**
     * Read-only FileSystemProvider для схемы `git:` — так ядро получает версию
     * файла из ревизии, не зная про git (как `GitFileSystemProvider` в VS Code).
     *
     * `onDidChangeFile` фаерится по изменению `.git` только для ресурсов, которые
     * у нас уже спрашивали: их немного (открытые редакторы), а рассылать событие
     * на весь репозиторий бессмысленно — потребитель кэширует ровно эти.
     */
    private registerFileSystemProvider(): void {
        const served = new Map<string, vscode.Uri>();
        this.disposables.push(this.fileChangeEmitter);
        // Команду регистрируем ДО провайдера схемы: нотификации идут по каналу
        // в порядке отправки, а ядро пересчитывает бары именно по появлению
        // поставщика — к этому моменту команда обязана уже существовать, иначе
        // стартовый кадр останется без баров до первой правки.
        // Аналог `QuickDiffProvider.provideOriginalResource`: решение «есть ли
        // оригинал» принимает расширение — только оно знает про untracked и репо.
        this.disposables.push(
            vscode.commands.registerCommand(ORIGINAL_RESOURCE_COMMAND, (rawUri: unknown, rawRef?: unknown) => {
                if (typeof rawUri !== "string") return null;
                const uri = vscode.Uri.parse(rawUri);
                if (uri.scheme !== "file") return null;
                const absPath = uri.fsPath;
                if (toRepoRelativePath(this.repoRoot, absPath) === null) return null;
                const ref = typeof rawRef === "string" && rawRef !== "" ? rawRef : "HEAD";
                // Untracked: в HEAD версии нет, сравнивать не с чем. Для явно
                // запрошенного ref проверка неприменима — статус рабочего дерева
                // ничего не говорит о наличии файла в произвольной ревизии
                // («файла на ref нет» ядро увидит пустой стороной при чтении).
                if (rawRef === undefined && this.status.get(absPath)?.xy.startsWith("?") === true) return null;
                return vscode.Uri.parse(rawUri).with(toGitUri(uri, ref)).toString();
            }),
        );

        this.disposables.push(
            vscode.workspace.registerFileSystemProvider(
                GIT_SCHEME,
                {
                    onDidChangeFile: this.fileChangeEmitter.event,
                    watch: () => new vscode.Disposable(() => undefined),
                    stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 }),
                    readFile: async (uri) => {
                        const params = fromGitUri(uri);
                        if (params === null) throw vscode.FileSystemError.FileNotFound(uri);
                        served.set(uri.toString(), uri);
                        try {
                            return await showFileAtRevision(this.repoRoot, params.path, params.ref, this.gitEnv);
                        } catch {
                            // Untracked/новый/удалённый — штатная ситуация, не сбой.
                            throw vscode.FileSystemError.FileNotFound(uri);
                        }
                    },
                },
                { isReadonly: true },
            ),
        );
        this.onGitDirChanged = () => {
            if (served.size === 0) return;
            this.fileChangeEmitter.fire(
                [...served.values()].map((uri) => ({ type: vscode.FileChangeType.Changed, uri })),
            );
        };
    }

    /** Wire providers, events and the initial refresh. Registers into `context.subscriptions`. */
    public start(context: vscode.ExtensionContext): void {
        this.disposables.push(this.fileDecoEmitter);
        this.registerFileSystemProvider();

        this.disposables.push(
            vscode.window.registerFileDecorationProvider({
                onDidChangeFileDecorations: this.fileDecoEmitter.event,
                provideFileDecoration: (uri) => this.provideFileDecoration(uri),
            }),
        );

        // Сохранение — это запись на диск, и watcher рабочего дерева его увидит;
        // подписка оставлена как быстрый и детерминированный путь для своих же
        // правок (событие приходит без задержки на обход дерева).
        // Смены активного редактора здесь СОЗНАТЕЛЬНО нет: диск от неё не
        // меняется, а `git status` на каждое переключение вкладки — тот самый
        // холостой RPC-шторм, ради которого выделяли `editor.selectionChanged`.
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(() => {
                this.guard("onDidSaveTextDocument", () => {
                    this.onFileChange();
                });
            }),
        );
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                this.guard("onDidChangeConfiguration", () => {
                    if (e.affectsConfiguration("git")) this.scheduleRefresh();
                });
            }),
        );

        // Ручной refresh из ядра (пункт «Refresh» меню view Graph). Ядро зовёт
        // best-effort через `commands.has()` — до активации расширения команда
        // просто отсутствует.
        this.disposables.push(
            vscode.commands.registerCommand("git.refresh", () => {
                this.guard("git.refresh", () => {
                    this.scheduleRefresh();
                });
            }),
        );

        // Мутации staging: ядро ждёт результат по возвратному каналу RPC.
        this.disposables.push(
            vscode.commands.registerCommand(STAGE_COMMAND, (payload: unknown) =>
                this.enqueueMutation((paths) => this.stage(paths), payload),
            ),
        );
        this.disposables.push(
            vscode.commands.registerCommand(UNSTAGE_COMMAND, (payload: unknown) =>
                this.enqueueMutation((paths) => this.unstage(paths), payload),
            ),
        );
        this.disposables.push(
            vscode.commands.registerCommand(CLEAN_COMMAND, (payload: unknown) =>
                this.enqueueMutation((paths) => this.clean(paths), payload),
            ),
        );
        // Семантический диспетчер операций (commit, дальше — sync/branch/stash):
        // argv собирает расширение, ядро оперирует именами операций.
        this.disposables.push(
            vscode.commands.registerCommand(GIT_OP_COMMAND, (payload: unknown) => this.enqueueOp(payload)),
        );
        // Read-only запросы данных для пикеров (вне очереди мутаций).
        this.disposables.push(
            vscode.commands.registerCommand(QUERY_COMMAND, (payload: unknown) => this.query(payload)),
        );

        this.startWatchers();

        // The plugin owns its disposables; register a single umbrella disposable.
        context.subscriptions.push({
            dispose: () => {
                this.dispose();
            },
        });

        // Initial paint (async, never throws). Раскрытость GRAPH спрашиваем до
        // неё: иначе первый `git log` уйдёт даже свёрнутой секции.
        void this.pullGraphEnabled().then(() => this.refreshAll());
    }

    private provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        try {
            if (!this.config().decorations) return undefined;
            const entry = this.status.get(uri.fsPath);
            if (entry === undefined) return undefined;
            return new vscode.FileDecoration(entry.deco.badge, undefined, new vscode.ThemeColor(entry.deco.colorId));
        } catch {
            return undefined;
        }
    }

    private config(): { master: boolean; decorations: boolean; debounce: number; autorefresh: boolean } {
        const cfg = vscode.workspace.getConfiguration("git");
        const master = cfg.get<boolean>("enabled", true);
        return {
            master,
            decorations: master && cfg.get<boolean>("decorations.enabled", true),
            debounce: normalizeDebounce(cfg.get<number>("refreshDebounce", 200)),
            autorefresh: master && cfg.get<boolean>("autorefresh", true),
        };
    }

    private scheduleRefresh(): void {
        if (this.isDisposed()) return;
        if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
        const debounce = this.config().debounce;
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            // Репозиторий занят мутацией — не рефрешим, а ждём: `git status`
            // дерётся с ней за `.git/index.lock`. Аналог `whenIdleAndFocused`
            // в VS Code (фокуса окна у нас нет — ждать нечего, кроме операции).
            if (this.pendingMutations > 0) {
                this.scheduleRefresh();
                return;
            }
            void this.refreshAll();
        }, debounce);
    }

    /**
     * Порядок важен: состояние репозитория обновляется до лога — из него
     * приезжает upstream, который {@link refreshLog} добавляет вторым ref'ом.
     */
    private async refreshAll(): Promise<void> {
        await this.refreshStatus();
        await this.refreshRepoState();
        // Свёрнутая или скрытая секция GRAPH не стоит подпроцесса `git log` на
        // каждое сохранение файла — ядро скажет, когда история понадобится.
        if (this.logEnabled) await this.refreshLog();
    }

    /**
     * Спрашивает ядро, раскрыта ли секция GRAPH. Ответ `undefined` — ядро этого
     * канала не знает (старая сборка, тестовый харнесс): тогда остаёмся при
     * дефолте «история нужна». Best-effort, как остальные каналы через границу.
     */
    private async pullGraphEnabled(): Promise<void> {
        try {
            const answer = await vscode.commands.executeCommand(GRAPH_ENABLED_COMMAND);
            this.logEnabled = answer !== false;
            /* v8 ignore next 3 -- best-effort: канал отвалится только при завершении процесса */
        } catch {
            // Канал недоступен — остаёмся при дефолте.
        }
    }

    /**
     * Публикует ядру состояние репозитория: ветка/detached/upstream/ahead-behind
     * из заголовков `status --porcelain=v2 --branch`, список remotes, и
     * merge/rebase/cherry-pick — fs-проверками служебных файлов `.git` (git-вызов
     * для этого не нужен). Best-effort, как остальные publish-каналы.
     */
    private async refreshRepoState(): Promise<void> {
        if (this.isDisposed()) return;
        const status = await this.git(["status", "--porcelain=v2", "--branch"]);
        if (status === null) return; // degraded: ядро остаётся при прежнем снимке
        const remotes = await this.git(["remote"]);

        const payload: IRepoStatePayload = {
            ...parseBranchHeaders(status.stdout),
            remotes: remotes === null ? [] : parseRemotes(remotes.stdout),
            state: this.detectRepoOpState(),
        };
        this.upstreamRef = payload.upstream;
        this.updateUpstreamWatcher(payload.upstream);
        void Promise.resolve(vscode.commands.executeCommand(PUBLISH_REPO_STATE_COMMAND, payload)).catch(
            /* v8 ignore next -- best-effort: канал отвалится только при завершении процесса */
            () => undefined,
        );
    }

    /** merge/rebase/cherry-pick по служебным файлам `.git` (как git сам). */
    private detectRepoOpState(): IRepoStatePayload["state"] {
        const exists = (rel: string): boolean => fs.existsSync(path.join(this.dotGit.path, rel));
        if (exists("MERGE_HEAD")) return "merging";
        if (exists("rebase-merge") || exists("rebase-apply")) return "rebasing";
        if (exists("CHERRY_PICK_HEAD")) return "cherry-picking";
        return "idle";
    }

    /** Страница истории из настройки `scm.graph.pageSize`, зажатая в 1..1000. */
    private logPageSize(): number {
        const raw = vscode.workspace.getConfiguration("scm").get<number>("graph.pageSize", LOG_PAGE_SIZE_DEFAULT);
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) return LOG_PAGE_SIZE_DEFAULT;
        return Math.min(Math.max(Math.floor(n), 1), LOG_PAGE_SIZE_MAX);
    }

    /** Текущий предел истории: накопленный по «Load More» либо одна страница. */
    private currentLogLimit(): number {
        return this.logLimit > 0 ? this.logLimit : this.logPageSize();
    }

    /**
     * Ref'ы истории графа — режим `auto` vscode: текущая ветка плюс её upstream,
     * чтобы в графе были видны и ещё не влитые коммиты remote.
     * `--ignore-missing` страхует от исчезнувшего upstream-ref'а: без него
     * `git log` вышел бы ненулевым и граф опустел бы целиком.
     */
    private logRefArgs(): string[] {
        const refs = ["HEAD"];
        if (this.upstreamRef !== null && this.upstreamRef !== "") refs.push(this.upstreamRef);
        return ["--ignore-missing", ...refs];
    }

    /**
     * Публикует ядру страницу истории (view Graph). Деградация — пустой
     * список: git недоступен или пустой репозиторий без HEAD (git log выходит
     * ненулевым). Best-effort, как {@link publishChanges}: повторную идентичную
     * публикацию гасит ядро, ошибку канала глотаем.
     *
     * Просим на коммит больше предела: лишний в граф не идёт, он лишь отвечает
     * на вопрос «есть ли что грузить дальше» — по нему ядро рисует строку
     * «Load More…».
     */
    private async refreshLog(): Promise<void> {
        if (this.isDisposed()) return;
        const limit = this.currentLogLimit();
        const result = await this.git([
            "log",
            "-n",
            String(limit + 1),
            ...LOG_FORMAT_ARGS,
            ...this.logRefArgs(),
        ]);
        const page = result === null ? [] : parseLogZ(result.stdout);
        const hasMore = page.length > limit;
        const payload = { commits: hasMore ? page.slice(0, limit) : page, hasMore };
        void Promise.resolve(vscode.commands.executeCommand(PUBLISH_LOG_COMMAND, payload)).catch(
            /* v8 ignore next -- best-effort: канал отвалится только при завершении процесса */
            () => undefined,
        );
    }

    /** Recompute `git status` → tree decorations. Clears everything when disabled/degraded. */
    private async refreshStatus(): Promise<void> {
        if (this.isDisposed()) return;
        const previous = new Set(this.status.keys());

        let next = new Map<string, IStatusEntry>();
        if (this.config().decorations) {
            const result = await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
            if (result !== null) {
                for (const e of parsePorcelainStatus(Buffer.from(result.stdout, "utf8"))) {
                    next.set(path.join(this.repoRoot, e.path), {
                        xy: e.xy,
                        relPath: e.path,
                        deco: statusToDecoration(e.xy),
                    });
                }
            } else {
                next = new Map(); // degraded → no decorations
            }
        }

        this.status = next;
        // Fire for the union of old ∪ new so removed files get cleared too.
        const affected = new Set<string>([...previous, ...next.keys()]);
        if (affected.size > 0 && !this.isDisposed()) {
            this.fileDecoEmitter.fire([...affected].map((p) => vscode.Uri.file(p)));
        }
        this.publishChanges(next);
    }

    /**
     * Публикует ядру полный набор изменённых файлов рабочего дерева (для вкладки
     * Changes) — тот же снимок `git status`, что красит дерево. Best-effort:
     * пустой набор снимает список; повторную идентичную публикацию гасит уже
     * ядро (`ScmChangesService`), поэтому здесь шлём безусловно. Ошибку канала
     * (например, при завершении процесса) молча глотаем — это не сбой git.
     */
    private publishChanges(entries: Map<string, IStatusEntry>): void {
        const resources = [...entries].flatMap(([absPath, entry]) =>
            xyToResourceStates(entry.xy).map((state) => ({
                uri: vscode.Uri.file(absPath).toString(),
                status: state.badge,
                colorId: state.colorId,
                path: entry.relPath,
                group: state.group,
            })),
        );
        void Promise.resolve(vscode.commands.executeCommand(PUBLISH_CHANGES_COMMAND, resources)).catch(
            /* v8 ignore next -- best-effort: канал отвалится только при завершении процесса */
            () => undefined,
        );
    }

    // ─── Мутации staging ──────────────────────────────────────────────────────

    /**
     * Хвост очереди мутаций. Мутации выполняются строго по одной: параллельные
     * `add`/`reset`/`checkout` дерутся за `.git/index.lock` (и с фоновым
     * `git status`, который тоже оппортунистически пишет index).
     */
    private mutationQueue: Promise<unknown> = Promise.resolve();

    /**
     * Ставит мутацию в очередь: валидация payload → git → немедленный refresh
     * (мимо debounce — список и декорации обязаны отразить мутацию сразу; watcher
     * `.git` продублирует, дедуп по подписи в ядре погасит). Пустой валидный
     * итог — no-op `{ok: true}` без git-вызова и refresh.
     */
    private enqueueMutation(
        run: (paths: string[]) => Promise<IGitMutationResult>,
        payload: unknown,
    ): Promise<IGitMutationResult> {
        const job = async (): Promise<IGitMutationResult> => {
            if (this.isDisposed()) return { ok: false, message: "git extension is shutting down" };
            const paths = this.parseMutationTargets(payload);
            if (paths.length === 0) return { ok: true };
            this.pendingMutations++;
            try {
                const result = await run(paths);
                if (!result.ok) log(`mutation failed: ${result.message ?? "unknown error"}`);
                await this.refreshAll();
                return result;
            } finally {
                this.pendingMutations--;
            }
        };
        const next = this.mutationQueue.then(job, job);
        this.mutationQueue = next.catch(() => undefined);
        return next;
    }

    /**
     * Валидация payload из-за границы процесса: массив строк-uri схемы `file`,
     * путь под корнем репозитория. Мусор молча отбрасывается. Возвращает
     * repo-относительные пути (для `git … -- <paths>`).
     */
    private parseMutationTargets(payload: unknown): string[] {
        if (!Array.isArray(payload)) return [];
        const paths: string[] = [];
        for (const raw of payload) {
            if (typeof raw !== "string") continue;
            let relative: string | null;
            try {
                const uri = vscode.Uri.parse(raw);
                if (uri.scheme !== "file") continue;
                relative = toRepoRelativePath(this.repoRoot, uri.fsPath);
            } catch {
                continue;
            }
            if (relative === null) continue;
            paths.push(relative);
        }
        return paths;
    }

    /** `git add -A -- <paths>`: стейджит правки, добавления и удаления. */
    private async stage(paths: string[]): Promise<IGitMutationResult> {
        return this.mutate(["add", "-A", "--", ...paths]);
    }

    /**
     * `git reset -q HEAD -- <paths>`; в пустом репозитории (unborn HEAD) reset
     * падает с «ambiguous argument 'HEAD'» — тогда снимаем из индекса напрямую:
     * `git rm --cached -r -q -- <paths>`.
     */
    private async unstage(paths: string[]): Promise<IGitMutationResult> {
        const result = await this.mutate(["reset", "-q", "HEAD", "--", ...paths]);
        if (!result.ok && (result.message?.includes("ambiguous argument 'HEAD'") ?? false)) {
            return this.mutate(["rm", "--cached", "-r", "-q", "--", ...paths]);
        }
        return result;
    }

    /**
     * Discard: tracked-пути откатываются к индексу (`git checkout -q --`),
     * untracked — удаляются (`git clean -q -f --`). Разделение — по нашей же
     * status-карте (снимок последнего `git status`).
     */
    private async clean(paths: string[]): Promise<IGitMutationResult> {
        const tracked: string[] = [];
        const untracked: string[] = [];
        for (const rel of paths) {
            const entry = this.status.get(path.join(this.repoRoot, ...rel.split("/")));
            (entry?.xy.startsWith("?") === true ? untracked : tracked).push(rel);
        }
        if (tracked.length > 0) {
            const result = await this.mutate(["checkout", "-q", "--", ...tracked]);
            if (!result.ok) return result;
        }
        if (untracked.length > 0) {
            return this.mutate(["clean", "-q", "-f", "--", ...untracked]);
        }
        return { ok: true };
    }

    // ─── Диспетчер операций (diode.git.op) ─────────────────────────────────────

    /**
     * Ставит операцию в общую очередь мутаций (одна за раз — тот же
     * `.git/index.lock`). Неизвестная операция или мусорный payload —
     * `{ok: false}`, не исключение: envelope едет через границу процесса.
     */
    private enqueueOp(payload: unknown): Promise<GitOpResult> {
        const job = async (): Promise<GitOpResult> => {
            if (this.isDisposed()) return { ok: false, kind: "unavailable", message: "git extension is shutting down" };
            if (typeof payload !== "object" || payload === null) {
                return { ok: false, kind: "git-error", message: "malformed git op request" };
            }
            const { op, params } = payload as { op?: unknown; params?: unknown };
            const opParams = typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
            let result: GitOpResult;
            this.pendingMutations++;
            try {
                result = await this.runOpByName(op, opParams);
            } finally {
                this.pendingMutations--;
            }
            if (!result.ok) log(`op ${String(op)} failed: ${result.message}`);
            await this.refreshAll();
            return result;
        };
        const next = this.mutationQueue.then(job, job);
        this.mutationQueue = next.catch(() => undefined);
        return next;
    }

    /** Диспетчер операций по имени: аргументы собирает `lib/*Args`, запускает {@link runBuilt}. */
    private async runOpByName(op: unknown, opParams: Record<string, unknown>): Promise<GitOpResult> {
        {
            let result: GitOpResult;
            switch (op) {
                case "commit":
                    result = await this.opCommit(opParams);
                    break;
                case "undoCommit":
                    result = await this.opUndoCommit();
                    break;
                case "pull":
                    result = await this.runOp(pullArgs(opParams), { network: true });
                    break;
                case "push":
                    result = await this.runOp(pushArgs(opParams), { network: true });
                    break;
                case "fetch":
                    result = await this.runOp(fetchArgs(opParams), { network: true });
                    break;
                case "sync": {
                    // Sync = pull → push; первый фейл прерывает.
                    result = await this.runOp(pullArgs(opParams), { network: true });
                    if (result.ok) result = await this.runOp(pushArgs({}), { network: true });
                    break;
                }
                case "checkout":
                    result = await this.runBuilt(checkoutArgs(opParams));
                    break;
                case "branchCreate":
                    result = await this.runBuilt(branchCreateArgs(opParams));
                    break;
                case "branchDelete":
                    result = await this.runBuilt(branchDeleteArgs(opParams));
                    break;
                case "branchRename":
                    result = await this.runBuilt(branchRenameArgs(opParams));
                    break;
                case "merge":
                    result = await this.runBuilt(mergeArgs(opParams));
                    break;
                case "mergeAbort":
                    result = await this.runOp(["merge", "--abort"]);
                    break;
                case "rebase":
                    result = await this.runBuilt(rebaseArgs(opParams));
                    break;
                case "rebaseAbort":
                    result = await this.runOp(["rebase", "--abort"]);
                    break;
                case "cherryPick":
                    result = await this.runBuilt(cherryPickArgs(opParams));
                    break;
                case "reset":
                    result = await this.runBuilt(resetArgs(opParams));
                    break;
                case "revert":
                    result = await this.runBuilt(revertArgs(opParams));
                    break;
                case "logSetEnabled":
                    // Не мутация, как и logLoadMore: свежая страница уедет ядру
                    // тем же refreshAll в конце операции.
                    this.logEnabled = opParams.enabled === true;
                    result = { ok: true };
                    break;
                case "logLoadMore":
                    // Не мутация, но идёт общей очередью: следующая страница
                    // уедет ядру тем же refreshAll в конце операции.
                    this.logLimit = this.currentLogLimit() + this.logPageSize();
                    result = { ok: true };
                    break;
                case "pushDelete":
                    result = await this.runBuilt(pushDeleteArgs(opParams), { network: true });
                    break;
                case "stashPush":
                    result = await this.runOp(stashPushArgs(opParams));
                    break;
                case "stashPop":
                    result = await this.runBuilt(stashPopArgs(opParams));
                    break;
                case "stashApply":
                    result = await this.runBuilt(stashApplyArgs(opParams));
                    break;
                case "stashDrop":
                    result = await this.runBuilt(stashDropArgs(opParams));
                    break;
                case "stashClear":
                    result = await this.runOp(["stash", "clear"]);
                    break;
                case "remoteAdd": {
                    result = await this.runBuilt(remoteAddArgs(opParams));
                    // Как VS Code: сразу fetch нового remote (best-effort).
                    if (result.ok) {
                        result = await this.runBuilt(fetchArgs({ remote: opParams.name }), { network: true });
                    }
                    break;
                }
                case "remoteRemove":
                    result = await this.runBuilt(remoteRemoveArgs(opParams));
                    break;
                case "tagCreate":
                    result = await this.runBuilt(tagCreateArgs(opParams));
                    break;
                case "tagDelete":
                    result = await this.runBuilt(tagDeleteArgs(opParams));
                    break;
                default:
                    result = { ok: false, kind: "git-error", message: `unknown git op: ${String(op)}` };
            }
            return result;
        }
    }

    /** `git commit` с флагами из параметров; пустое сообщение допустимо только с amend (`--no-edit`). */
    private async opCommit(raw: Record<string, unknown>): Promise<GitOpResult> {
        const params: IGitCommitParams = {
            message: typeof raw.message === "string" ? raw.message : "",
            amend: raw.amend === true,
            all: raw.all === true,
            noVerify: raw.noVerify === true,
            allowEmpty: raw.allowEmpty === true,
        };
        const args = ["commit"];
        if (params.amend) args.push("--amend");
        if (params.all) args.push("--all");
        if (params.noVerify) args.push("--no-verify");
        if (params.allowEmpty) args.push("--allow-empty");
        if (params.message !== "") {
            args.push("-m", params.message);
        } else if (params.amend) {
            args.push("--no-edit");
        } else {
            return { ok: false, kind: "git-error", message: "commit message is empty" };
        }
        return this.runOp(args);
    }

    /**
     * Undo Last Commit: guard — у HEAD есть ровно один родитель (merge-коммит и
     * корневой не откатываем, как VS Code) → сообщение → `reset --soft HEAD~`.
     * Сообщение уезжает в data — ядро вернёт его в commit input box.
     */
    private async opUndoCommit(): Promise<GitOpResult> {
        const parents = await this.gitRaw(["rev-list", "--parents", "-1", "HEAD"]);
        if ("error" in parents || parents.code !== 0) {
            return { ok: false, kind: "git-error", message: "no commit to undo" };
        }
        const tokens = parents.stdout.trim().split(/\s+/).filter((t) => t !== "");
        if (tokens.length !== 2) {
            return {
                ok: false,
                kind: "git-error",
                message: tokens.length > 2 ? "cannot undo a merge commit" : "cannot undo the initial commit",
            };
        }
        const messageResult = await this.gitRaw(["log", "-1", "--format=%B"]);
        const message = "error" in messageResult || messageResult.code !== 0 ? "" : messageResult.stdout;
        const reset = await this.runOp(["reset", "--soft", "HEAD~"]);
        if (!reset.ok) return reset;
        return { ok: true, data: { message: message.replace(/\n+$/, "") } };
    }

    /** Обёртка над {@link runOp} для builder-ов: `null` от билдера = невалидные параметры. */
    private runBuilt(args: string[] | null, opts?: { network?: boolean }): Promise<GitOpResult> {
        if (args === null) {
            return Promise.resolve({ ok: false, kind: "git-error", message: "invalid git op parameters" });
        }
        return this.runOp(args, opts);
    }

    /**
     * Одна операция → envelope; не-нулевой код классифицируется по stderr
     * ({@link classifyGitStderr}). Сетевые вызовы — `GIT_TERMINAL_PROMPT=0`
     * (tty у субпроцесса нет, промпт за credentials должен упасть быстро и
     * стать `auth`-ошибкой) и увеличенный таймаут.
     */
    private async runOp(args: string[], opts?: { network?: boolean }): Promise<GitOpResult> {
        const result = await this.gitRaw(args, opts);
        if ("error" in result) return { ok: false, kind: "unavailable", message: result.error.message };
        if (result.code !== 0) {
            const output = result.stderr.trim() !== "" ? result.stderr : result.stdout;
            const firstLine = output.trim().split("\n")[0] ?? "";
            return {
                ok: false,
                kind: classifyGitStderr(`${result.stderr}\n${result.stdout}`),
                message: firstLine === "" ? `git ${args[0]} exited ${result.code}` : firstLine,
                stderr: result.stderr,
            };
        }
        return { ok: true };
    }

    /** Сырой запуск git в репо (без деградационного логирования {@link git}). */
    private gitRaw(args: string[], opts?: { network?: boolean }): Promise<IRunGitResult | IRunGitError> {
        const runOpts: IRunGitOptions = { cwd: this.repoRoot };
        if (opts?.network === true) {
            runOpts.env = { ...(this.gitEnv ?? process.env), GIT_TERMINAL_PROMPT: "0" };
            runOpts.timeoutMs = 60_000;
        } else if (this.gitEnv !== undefined) {
            runOpts.env = this.gitEnv;
        }
        return runGit(args, runOpts);
    }

    // ─── Read-only запросы для пикеров (diode.git.query) ──────────────────────

    /** `{kind: refs|stashes|remotes}` → данные пикеров; мусор/деградация — null. */
    private async query(payload: unknown): Promise<unknown> {
        if (typeof payload !== "object" || payload === null) return null;
        const { kind } = payload as { kind?: unknown };
        if (kind === "refs") {
            const result = await this.git([
                "for-each-ref",
                "--sort=-committerdate",
                `--format=${FOR_EACH_REF_FORMAT}`,
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ]);
            return result === null ? null : { refs: parseForEachRefZ(result.stdout) };
        }
        if (kind === "stashes") {
            const result = await this.git(["stash", "list", `--format=${STASH_LIST_FORMAT}`]);
            return result === null ? null : { stashes: parseStashListZ(result.stdout) };
        }
        if (kind === "remotes") {
            const result = await this.git(["remote"]);
            return result === null ? null : { remotes: parseRemotes(result.stdout) };
        }
        return null;
    }

    /** Одна git-мутация → envelope: не-нулевой код или несоздавшийся процесс = `{ok: false}`. */
    private async mutate(args: string[]): Promise<IGitMutationResult> {
        const opts: IRunGitOptions = { cwd: this.repoRoot };
        if (this.gitEnv !== undefined) opts.env = this.gitEnv;
        const result = await runGit(args, opts);
        if ("error" in result) return { ok: false, message: result.error.message };
        if (result.code !== 0) {
            const firstLine = result.stderr.trim().split("\n")[0] ?? "";
            return { ok: false, message: firstLine === "" ? `git ${args[0]} exited ${result.code}` : firstLine };
        }
        return { ok: true };
    }

    /**
     * Run git in the repo; returns a successful result or `null` (degraded — logged once).
     *
     * Read-путь идёт с `GIT_OPTIONAL_LOCKS=0`: `git status` оппортунистически
     * обновляет index и берёт `.git/index.lock` — фоновые refresh'ы дрались бы
     * за него с мутациями пользователя (`git add` рядом с работающим редактором
     * фейлился «Unable to create index.lock»). Цена — status не кэширует
     * stat-данные в index; для наших размеров репо это незаметно.
     */
    private async git(args: string[]): Promise<IRunGitResult | null> {
        const opts: IRunGitOptions = { cwd: this.repoRoot };
        opts.env = { ...(this.gitEnv ?? process.env), GIT_OPTIONAL_LOCKS: "0" };
        const result = await runGit(args, opts);
        if ("error" in result) {
            if (!this.loggedGitFailure) {
                this.loggedGitFailure = true;
                log(`git unavailable (${result.error.message}) — decorations disabled`);
            }
            return null;
        }
        if (result.code !== 0) {
            if (!this.loggedGitFailure) {
                this.loggedGitFailure = true;
                log(`git ${args[0]} exited ${result.code}: ${result.stderr.trim()}`);
            }
            return null;
        }
        return result;
    }

    private isUnderRepo(absPath: string): boolean {
        const rel = path.relative(this.repoRoot, absPath);
        return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    }

    /**
     * Заводит файловые watcher'ы — раскладка VS Code (`Repository` в
     * `extensions/git/src/repository.ts`):
     *
     * - **рабочее дерево** целиком (`**`): без него редактор видит только свои
     *   сохранения, а правка из терминала, чужого редактора или скрипта в
     *   Changes и декорациях не появляется до следующего события;
     * - **служебный каталог** (`.git`, первый уровень): checkout, commit, stage
     *   и состояние merge/rebase — всё это правки его прямых детей. Каталог
     *   берём из `rev-parse`, а не склейкой `<root>/.git`: в worktree это файл;
     * - **общий каталог**, если он отдельный (worktree/submodule): там живут
     *   `refs` и `packed-refs` — по ним видно чужой fetch;
     * - **ref upstream'а** — transient, см. {@link updateUpstreamWatcher}.
     *
     * Событий `.git` касается и вторая обязанность: версии в схеме `git:`
     * устарели, и ядру надо перечитать оригиналы (иначе бары в гуттере считаются
     * против старого HEAD).
     */
    private startWatchers(): void {
        this.watch(this.repoRoot, "**", (uri) => {
            if (isRelevantWorkingTreeEvent(this.repoRoot, uri.fsPath)) this.onFileChange();
        });
        this.watch(this.dotGit.path, "*", (uri) => {
            if (!isRelevantDotGitEvent(uri.fsPath)) return;
            this.onFileChange();
            this.onGitDirChanged?.();
        });
        const common = refsRoot(this.dotGit);
        if (common !== this.dotGit.path) {
            this.watch(common, "*", (uri) => {
                if (isRelevantDotGitEvent(uri.fsPath)) this.onFileChange();
            });
        }
    }

    /** Подписка на create/change/delete одного watcher'а; ошибки не выпускаем наружу. */
    private watch(base: string, pattern: string, onEvent: (uri: vscode.Uri) => void): vscode.Disposable {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, pattern));
        const handler = (uri: vscode.Uri): void => {
            this.guard("fileWatcher", () => onEvent(uri));
        };
        watcher.onDidCreate(handler);
        watcher.onDidChange(handler);
        watcher.onDidDelete(handler);
        this.disposables.push(watcher);
        return watcher;
    }

    /**
     * Пересаживает watcher на ref upstream'а текущей ветки. Без него ahead/behind
     * оживает только по своим операциям: чужой `git fetch` трогает
     * `refs/remotes/<remote>/<branch>` — файл, до которого watcher'ы `.git`
     * (первый уровень) не достают.
     *
     * Следим за **каталогом** ref'а с точным именем в шаблоне, а не за самим
     * файлом: git пишет ref'ы атомарной заменой (`rename`), после которой
     * подписка на inode исходного файла мертва.
     */
    private updateUpstreamWatcher(upstream: string | null): void {
        const refPath = upstreamRefPath(this.dotGit, upstream);
        if (refPath === this.upstreamWatchedRef) return;
        this.upstreamWatchedRef = refPath;
        this.upstreamWatcher?.dispose();
        this.upstreamWatcher = undefined;
        if (refPath === null) return;
        this.upstreamWatcher = this.watch(path.dirname(refPath), path.basename(refPath), () => {
            this.onFileChange();
        });
    }

    /**
     * Реакция на файловое событие — гейты VS Code (`Repository.onFileChange`):
     * выключенный `git.autorefresh` и занятый мутацией репозиторий рефреш не
     * запускают.
     */
    private onFileChange(): void {
        if (!this.config().autorefresh) return;
        this.scheduleRefresh();
    }

    /** Run a handler, swallowing and logging any throw so nothing reaches the host. */
    private guard(where: string, fn: () => void): void {
        try {
            fn();
        } catch (err) {
            log(`handler ${where} failed: ${String(err)}`);
        }
    }

    public dispose(): void {
        if (this.isDisposed()) return;
        this.#disposed = true;
        if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
        this.upstreamWatcher?.dispose();
        for (const d of this.disposables.splice(0).reverse()) {
            try {
                d.dispose();
            } catch {
                // swallow
            }
        }
    }
}

function normalizeDebounce(value: unknown): number {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return 200;
    return Math.min(n, 5000);
}

/** Build the child-process env that prefers `git.path`'s directory, if configured. */
function gitEnvFor(gitPath: string): NodeJS.ProcessEnv | undefined {
    if (gitPath === "") return undefined;
    const dir = path.dirname(gitPath);
    const sep = path.delimiter;
    const currentPath = process.env.PATH ?? "";
    return { ...process.env, PATH: currentPath === "" ? dir : `${dir}${sep}${currentPath}` };
}

/**
 * Резолвит репозиторий вокруг `cwd`: корень рабочего дерева и служебный
 * каталог. `null` — не репозиторий или git недоступен.
 *
 * Одним `rev-parse`: корень и `.git` обязаны быть согласованы, а два вызова —
 * это ещё и два процесса на старте. Пути `--git-dir`/`--git-common-dir` git
 * отдаёт относительно cwd вызова, поэтому нормализует их {@link parseDotGit}.
 */
async function detectRepository(
    cwd: string,
    gitEnv: NodeJS.ProcessEnv | undefined,
): Promise<{ root: string; dotGit: IDotGit } | null> {
    const opts: IRunGitOptions = { cwd };
    if (gitEnv !== undefined) opts.env = gitEnv;
    const result = await runGit(["rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir"], opts);
    if ("error" in result || result.code !== 0) return null;
    const [root, ...rest] = result.stdout.split("\n").map((line) => line.trim());
    if (root === undefined || root === "") return null;
    const dotGit = parseDotGit(rest.join("\n"), cwd);
    return dotGit === null ? null : { root, dotGit };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        const folders = vscode.workspace.workspaceFolders;
        const cwd = folders?.[0]?.uri.fsPath;
        if (cwd === undefined) {
            log("no workspace folder — git integration inactive");
            return;
        }

        const gitPath = vscode.workspace.getConfiguration("git").get<string>("path", "");
        const gitEnv = gitEnvFor(gitPath);

        const repository = await detectRepository(cwd, gitEnv);
        if (repository === null) {
            log(`not a git repository (or git unavailable): ${cwd}`);
            return;
        }

        log(`git integration active: ${repository.root} (git dir: ${repository.dotGit.path})`);
        const decorations = new GitDecorations(repository.root, repository.dotGit, gitEnv);
        decorations.start(context);
    } catch (err) {
        // activate() must never throw into the host.
        log(`activate failed: ${String(err)}`);
    }
}
