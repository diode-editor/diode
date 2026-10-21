import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

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
import type { IDotGit } from "./lib/dotGit.ts";
import { parseDotGit, refsRoot, upstreamRefPath } from "./lib/dotGit.ts";
import { showFileAtRevision, toRepoRelativePath } from "./lib/gitShow.ts";
import { fromGitUri, GIT_SCHEME, ORIGINAL_RESOURCE_COMMAND, toGitUri } from "./lib/gitUri.ts";
import { LOG_FORMAT_ARGS, parseLogZ } from "./lib/logParse.ts";
import type { IStatusDecoration } from "./lib/map.ts";
import { statusToDecoration, xyToResourceStates } from "./lib/map.ts";
import { parsePorcelainStatus, pathAtHead } from "./lib/porcelain.ts";
import type { GitOpResult, IGitCommitParams } from "./lib/protocol.ts";
import { GIT_OP_COMMAND } from "./lib/protocol.ts";
import { FOR_EACH_REF_FORMAT, parseForEachRefZ, parseStashListZ, STASH_LIST_FORMAT } from "./lib/queryParse.ts";
import { remoteAddArgs, remoteRemoveArgs, tagCreateArgs, tagDeleteArgs } from "./lib/remoteArgs.ts";
import type { IRepoStatePayload } from "./lib/repoState.ts";
import { parseBranchHeaders, parseRemotes } from "./lib/repoState.ts";
import { resetArgs, revertArgs } from "./lib/resetArgs.ts";
import type { IRunGitError, IRunGitOptions, IRunGitResult } from "./lib/runGit.ts";
import { runGit } from "./lib/runGit.ts";
import { stashApplyArgs, stashDropArgs, stashPopArgs, stashPushArgs } from "./lib/stashArgs.ts";
import { fetchArgs, pullArgs, pushArgs } from "./lib/syncArgs.ts";
import { isRelevantDotGitEvent, isRelevantWorkingTreeEvent } from "./lib/watch.ts";

/**
 * Любая плохая среда (нет workspace/репо/бинаря, ненулевой exit) деградирует в
 * «нет декораций» плюс одну строку лога: {@link runGit} не реджектится, обработчики
 * обёрнуты — до хоста ничего не долетает.
 */

function log(message: string): void {
    // stdout субпроцесса уходит в лог `extensions.host.stdout`, не в pty TUI.
    console.log(`[git] ${message}`);
}

// Id команд ядра дублируются строками: через границу процесса общих импортов нет.
const PUBLISH_CHANGES_COMMAND = "diode.scm.publishChanges";

const PUBLISH_LOG_COMMAND = "diode.scm.publishLog";
/**
 * Пока секция GRAPH свёрнута, `git log` не запускаем вовсе. Спрашиваем один раз
 * при активации, дальше ядро присылает `logSetEnabled`.
 */
const GRAPH_ENABLED_COMMAND = "diode.scm.graphEnabled";

const PUBLISH_REPO_STATE_COMMAND = "diode.scm.publishRepoState";

const QUERY_COMMAND = "diode.git.query";

/** Как в vscode: дефолт `scm.graph.pageSize` — 50, потолок 1000. */
const LOG_PAGE_SIZE_DEFAULT = 50;
const LOG_PAGE_SIZE_MAX = 1000;

/**
 * Не `git.*`: user-facing команды живут в ядре, одноимённая регистрация перезаписала
 * бы их в CommandRegistry. Аргумент — массив строк-uri.
 */
const STAGE_COMMAND = "diode.git.stage";
const UNSTAGE_COMMAND = "diode.git.unstage";
const CLEAN_COMMAND = "diode.git.clean";

interface IGitMutationResult {
    readonly ok: boolean;
    /** Первая строка stderr — при `ok: false`. */
    readonly message?: string;
}

interface IStatusEntry {
    readonly xy: string;
    /** Относительно корня репозитория, всегда через `/`. */
    readonly relPath: string;
    /** У переименования — исходный путь ({@link pathAtHead}). */
    readonly headRelPath: string;
    readonly deco: IStatusDecoration;
}

class GitDecorations {
    private readonly repoRoot: string;
    private readonly dotGit: IDotGit;
    private readonly gitEnv: NodeJS.ProcessEnv | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    /** По абсолютному пути. */
    private status = new Map<string, IStatusEntry>();
    private readonly fileDecoEmitter = new vscode.EventEmitter<vscode.Uri[]>();
    private readonly fileChangeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private onGitDirChanged: (() => void) | undefined;

    /** 0 — страница по умолчанию (значение настройки). */
    private logLimit = 0;
    /**
     * Дефолт «нужна»: ядро без канала `graphEnabled` иначе осталось бы с пустым
     * графом навсегда. Настоящее значение приезжает в {@link pullGraphEnabled}.
     */
    private logEnabled = true;
    /** Второй ref истории графа (режим `auto` vscode). */
    private upstreamRef: string | null = null;

    private refreshTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Пока не ноль, файловые события рефреш не запускают: `git status` дрался бы за
     * `.git/index.lock` с операцией, а та закончится своим refreshAll.
     */
    private pendingMutations = 0;
    /** Пересоздаётся на каждый снимок состояния: upstream меняется вместе с веткой. */
    private upstreamWatcher: vscode.Disposable | undefined;
    private upstreamWatchedRef: string | null = null;
    #disposed = false;
    // Метод, а не поле/геттер: результат вызова TS не сужает, и проверки после
    // await не «залипают».
    private isDisposed(): boolean {
        return this.#disposed;
    }

    private loggedGitFailure = false;

    public constructor(repoRoot: string, dotGit: IDotGit, gitEnv: NodeJS.ProcessEnv | undefined) {
        this.repoRoot = repoRoot;
        this.dotGit = dotGit;
        this.gitEnv = gitEnv;
    }

    /**
     * Как `GitFileSystemProvider` в VS Code. `onDidChangeFile` — только для уже
     * спрошенных ресурсов: потребитель кэширует ровно их.
     */
    private registerFileSystemProvider(): void {
        const served = new Map<string, vscode.Uri>();
        this.disposables.push(this.fileChangeEmitter);
        // Команда — ДО провайдера схемы: ядро пересчитывает бары по появлению
        // поставщика, и без команды стартовый кадр остался бы без баров до первой правки.
        this.disposables.push(
            vscode.commands.registerCommand(ORIGINAL_RESOURCE_COMMAND, (rawUri: unknown, rawRef?: unknown) => {
                if (typeof rawUri !== "string") return null;
                const uri = vscode.Uri.parse(rawUri);
                if (uri.scheme !== "file") return null;
                const absPath = uri.fsPath;
                if (toRepoRelativePath(this.repoRoot, absPath) === null) return null;
                const ref = typeof rawRef === "string" && rawRef !== "" ? rawRef : "HEAD";
                // Статус рабочего дерева ничего не говорит о произвольном ref —
                // untracked и переименование учитываем только для HEAD.
                const entry = this.status.get(absPath);
                if (rawRef === undefined && entry?.xy.startsWith("?") === true) return null;
                const source =
                    ref === "HEAD" && entry !== undefined && entry.headRelPath !== entry.relPath
                        ? vscode.Uri.file(path.join(this.repoRoot, entry.headRelPath))
                        : uri;
                return vscode.Uri.parse(rawUri).with(toGitUri(source, ref)).toString();
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
                    writeFile: (uri) => {
                        throw vscode.FileSystemError.NoPermissions(uri);
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

    public start(context: vscode.ExtensionContext): void {
        this.disposables.push(this.fileDecoEmitter);
        this.registerFileSystemProvider();

        this.disposables.push(
            vscode.window.registerFileDecorationProvider({
                onDidChangeFileDecorations: this.fileDecoEmitter.event,
                provideFileDecoration: (uri) => this.provideFileDecoration(uri),
            }),
        );

        // Watcher увидит и сохранение, но эта подписка быстрее и детерминированнее.
        // Смены активного редактора СОЗНАТЕЛЬНО нет: диск не меняется, а `git status`
        // на каждую вкладку — холостой RPC-шторм.
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

        this.disposables.push(
            vscode.commands.registerCommand("git.refresh", () => {
                this.guard("git.refresh", () => {
                    this.scheduleRefresh();
                });
            }),
        );

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
        // argv собирает расширение, ядро оперирует именами операций.
        this.disposables.push(
            vscode.commands.registerCommand(GIT_OP_COMMAND, (payload: unknown) => this.enqueueOp(payload)),
        );
        // Вне очереди мутаций.
        this.disposables.push(
            vscode.commands.registerCommand(QUERY_COMMAND, (payload: unknown) => this.query(payload)),
        );

        this.startWatchers();

        context.subscriptions.push({
            dispose: () => {
                this.dispose();
            },
        });

        // Раскрытость GRAPH — до первого рефреша: иначе `git log` уйдёт и свёрнутой секции.
        void this.pullGraphEnabled().then(() => this.refreshAll());
    }

    private provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        try {
            if (!this.config().decorations) return undefined;
            const entry = this.status.get(uri.fsPath);
            if (entry === undefined) return undefined;
            const decoration = new vscode.FileDecoration(
                entry.deco.badge,
                undefined,
                new vscode.ThemeColor(entry.deco.colorId),
            );
            decoration.propagate = entry.deco.propagate;
            return decoration;
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
            // Аналог `whenIdleAndFocused` VS Code: `git status` дрался бы с
            // мутацией за `.git/index.lock`.
            if (this.pendingMutations > 0) {
                this.scheduleRefresh();
                return;
            }
            void this.refreshAll();
        }, debounce);
    }

    /** Состояние репозитория — до лога: из него приезжает upstream, второй ref {@link refreshLog}. */
    private async refreshAll(): Promise<void> {
        await this.refreshStatus();
        await this.refreshRepoState();
        if (this.logEnabled) await this.refreshLog();
    }

    /** `undefined` — ядро канала не знает (старая сборка, харнесс): остаёмся при «история нужна». */
    private async pullGraphEnabled(): Promise<void> {
        try {
            const answer = await vscode.commands.executeCommand(GRAPH_ENABLED_COMMAND);
            this.logEnabled = answer !== false;
            /* v8 ignore next 3 -- best-effort: канал отвалится только при завершении процесса */
        } catch {
            // Канал недоступен — остаёмся при дефолте.
        }
    }

    private async refreshRepoState(): Promise<void> {
        if (this.isDisposed()) return;
        const status = await this.git(["status", "--porcelain=v2", "--branch"]);
        if (status === null) return; // ядро остаётся при прежнем снимке
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

    /** По служебным файлам `.git`, как git сам. */
    private detectRepoOpState(): IRepoStatePayload["state"] {
        const exists = (rel: string): boolean => fs.existsSync(path.join(this.dotGit.path, rel));
        if (exists("MERGE_HEAD")) return "merging";
        if (exists("rebase-merge") || exists("rebase-apply")) return "rebasing";
        if (exists("CHERRY_PICK_HEAD")) return "cherry-picking";
        return "idle";
    }

    private logPageSize(): number {
        const raw = vscode.workspace.getConfiguration("scm").get<number>("graph.pageSize", LOG_PAGE_SIZE_DEFAULT);
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) return LOG_PAGE_SIZE_DEFAULT;
        return Math.min(Math.max(Math.floor(n), 1), LOG_PAGE_SIZE_MAX);
    }

    private currentLogLimit(): number {
        return this.logLimit > 0 ? this.logLimit : this.logPageSize();
    }

    /**
     * Режим `auto` vscode: ветка плюс upstream. `--ignore-missing` — без него исчезнувший
     * upstream-ref дал бы ненулевой exit, и граф опустел бы целиком.
     */
    private logRefArgs(): string[] {
        const refs = ["HEAD"];
        if (this.upstreamRef !== null && this.upstreamRef !== "") refs.push(this.upstreamRef);
        return ["--ignore-missing", ...refs];
    }

    /** Лишний коммит сверх предела в граф не идёт — он лишь говорит, рисовать ли «Load More…». */
    private async refreshLog(): Promise<void> {
        if (this.isDisposed()) return;
        const limit = this.currentLogLimit();
        const result = await this.git(["log", "-n", String(limit + 1), ...LOG_FORMAT_ARGS, ...this.logRefArgs()]);
        const page = result === null ? [] : parseLogZ(result.stdout);
        const hasMore = page.length > limit;
        const payload = { commits: hasMore ? page.slice(0, limit) : page, hasMore };
        void Promise.resolve(vscode.commands.executeCommand(PUBLISH_LOG_COMMAND, payload)).catch(
            /* v8 ignore next -- best-effort: канал отвалится только при завершении процесса */
            () => undefined,
        );
    }

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
                        headRelPath: pathAtHead(e),
                        deco: statusToDecoration(e.xy),
                    });
                }
            } else {
                next = new Map();
            }
        }

        this.status = next;
        // old ∪ new — чтобы снять декорации и с ушедших файлов.
        const affected = new Set<string>([...previous, ...next.keys()]);
        if (affected.size > 0 && !this.isDisposed()) {
            this.fileDecoEmitter.fire([...affected].map((p) => vscode.Uri.file(p)));
        }
        this.publishChanges(next);
    }

    /** Шлём безусловно: повторную идентичную публикацию гасит ядро (`ScmChangesService`). */
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

    /**
     * Строго по одной: параллельные `add`/`reset`/`checkout` дерутся за
     * `.git/index.lock` (и с фоновым `git status`, который тоже пишет index).
     */
    private mutationQueue: Promise<unknown> = Promise.resolve();

    /** Refresh — мимо debounce, сразу; дубль от watcher'а `.git` погасит дедуп в ядре. */
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

    /** Payload из-за границы процесса: мусор и пути вне репозитория молча отбрасываются. */
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

    private async stage(paths: string[]): Promise<IGitMutationResult> {
        return this.mutate(["add", "-A", "--", ...paths]);
    }

    /** При unborn HEAD reset падает с «ambiguous argument 'HEAD'» — тогда `rm --cached`. */
    private async unstage(paths: string[]): Promise<IGitMutationResult> {
        const result = await this.mutate(["reset", "-q", "HEAD", "--", ...paths]);
        if (!result.ok && (result.message?.includes("ambiguous argument 'HEAD'") ?? false)) {
            return this.mutate(["rm", "--cached", "-r", "-q", "--", ...paths]);
        }
        return result;
    }

    /** Tracked от untracked отличаем по снимку последнего `git status`. */
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

    /** Общая очередь мутаций — тот же `.git/index.lock`. Мусорный payload — `{ok: false}`, не исключение. */
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
                    // Не мутация, но идёт общей очередью: страница уедет ядру
                    // refreshAll'ом в конце операции. Так же logLoadMore.
                    this.logEnabled = opParams.enabled === true;
                    result = { ok: true };
                    break;
                case "logLoadMore":
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

    /** Merge-коммит и корневой не откатываем, как VS Code; сообщение ядро вернёт в commit input box. */
    private async opUndoCommit(): Promise<GitOpResult> {
        const parents = await this.gitRaw(["rev-list", "--parents", "-1", "HEAD"]);
        if ("error" in parents || parents.code !== 0) {
            return { ok: false, kind: "git-error", message: "no commit to undo" };
        }
        const tokens = parents.stdout
            .trim()
            .split(/\s+/)
            .filter((t) => t !== "");
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

    /** `null` от билдера — невалидные параметры. */
    private runBuilt(args: string[] | null, opts?: { network?: boolean }): Promise<GitOpResult> {
        if (args === null) {
            return Promise.resolve({ ok: false, kind: "git-error", message: "invalid git op parameters" });
        }
        return this.runOp(args, opts);
    }

    /** Сеть — `GIT_TERMINAL_PROMPT=0`: tty нет, промпт за credentials должен быстро стать `auth`-ошибкой. */
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

    /** Без деградационного логирования {@link git}. */
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
     * `null` — деградация, логируется один раз. `GIT_OPTIONAL_LOCKS=0`: иначе фоновый
     * `git status` берёт `.git/index.lock`, и `git add` пользователя падал
     * «Unable to create index.lock». Цена — status не кэширует stat в index.
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
     * Раскладка VS Code (`Repository` в `extensions/git/src/repository.ts`): рабочее
     * дерево целиком — иначе правка из терминала не видна до следующего события;
     * `.git` первого уровня — checkout/commit/stage/merge; общий каталог — чужой fetch.
     * Событие `.git` ещё и устаревает версии `git:` — иначе бары считались бы против старого HEAD.
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

    private watch(base: string, pattern: string, onEvent: (uri: vscode.Uri) => void): vscode.Disposable {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, pattern));
        const handler = (uri: vscode.Uri): void => {
            this.guard("fileWatcher", () => {
                onEvent(uri);
            });
        };
        watcher.onDidCreate(handler);
        watcher.onDidChange(handler);
        watcher.onDidDelete(handler);
        this.disposables.push(watcher);
        return watcher;
    }

    /**
     * Чужой `git fetch` трогает `refs/remotes/<remote>/<branch>` — глубже первого
     * уровня `.git`. Следим за **каталогом** с точным именем, а не за файлом: git пишет
     * ref атомарным `rename`, и подписка на inode исходного файла мертва.
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

    /** Гейты VS Code (`Repository.onFileChange`). */
    private onFileChange(): void {
        if (!this.config().autorefresh) return;
        this.scheduleRefresh();
    }

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

function gitEnvFor(gitPath: string): NodeJS.ProcessEnv | undefined {
    if (gitPath === "") return undefined;
    const dir = path.dirname(gitPath);
    const sep = path.delimiter;
    const currentPath = process.env.PATH ?? "";
    return { ...process.env, PATH: currentPath === "" ? dir : `${dir}${sep}${currentPath}` };
}

/** Одним `rev-parse`: корень и `.git` обязаны быть согласованы. */
async function detectRepository(
    cwd: string,
    gitEnv: NodeJS.ProcessEnv | undefined,
): Promise<{ root: string; dotGit: IDotGit } | null> {
    const opts: IRunGitOptions = { cwd };
    if (gitEnv !== undefined) opts.env = gitEnv;
    const result = await runGit(["rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir"], opts);
    if ("error" in result || result.code !== 0) return null;
    const lines = result.stdout.split("\n").map((line) => line.trim());
    const root = lines.at(0);
    const rest = lines.slice(1);
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
        log(`activate failed: ${String(err)}`);
    }
}
