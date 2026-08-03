import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { showFileAtRevision, toRepoRelativePath } from "./lib/gitShow.ts";
import { fromGitUri, GIT_SCHEME, ORIGINAL_RESOURCE_COMMAND, toGitUri } from "./lib/gitUri.ts";
import type { IStatusDecoration } from "./lib/map.ts";
import { statusToDecoration, xyToResourceStates } from "./lib/map.ts";
import { parsePorcelainStatus } from "./lib/porcelain.ts";
import { LOG_FORMAT_ARGS, parseLogZ } from "./lib/logParse.ts";
import type { GitOpResult, IGitCommitParams } from "./lib/protocol.ts";
import { GIT_OP_COMMAND } from "./lib/protocol.ts";
import { classifyGitStderr } from "./lib/classifyGitError.ts";
import { FOR_EACH_REF_FORMAT, parseForEachRefZ, parseStashListZ, STASH_LIST_FORMAT } from "./lib/queryParse.ts";
import type { IRepoStatePayload } from "./lib/repoState.ts";
import { parseBranchHeaders, parseRemotes } from "./lib/repoState.ts";
import { fetchArgs, pullArgs, pushArgs } from "./lib/syncArgs.ts";
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
    // channel (→ ./vexx.log in dev); it never touches the TUI pty.
    console.log(`[git] ${message}`);
}

/**
 * Команда ядра, которой мы публикуем полный набор изменённых файлов (вкладка
 * Changes). Ядро её регистрирует (`ScmChangesService`); строка совпадает по
 * значению, как и у `ORIGINAL_RESOURCE_COMMAND` — модули по разные стороны
 * границы процесса общих импортов не имеют.
 */
const PUBLISH_CHANGES_COMMAND = "vexx.scm.publishChanges";

/**
 * Команда ядра, которой мы публикуем последние коммиты (view Graph). Ядро её
 * регистрирует (`ScmGraphService`); строка дублируется по значению — общих
 * импортов через границу процесса нет.
 */
const PUBLISH_LOG_COMMAND = "vexx.scm.publishLog";

/**
 * Команда ядра для снимка состояния репозитория (ветка/upstream/ahead-behind/
 * remotes/merge-rebase). Ядро регистрирует (`ScmRepoStateService`) и деривирует
 * when-ключи git*-команд.
 */
const PUBLISH_REPO_STATE_COMMAND = "vexx.scm.publishRepoState";

/** Read-only запрос данных для пикеров ядра: refs / stashes / remotes. */
const QUERY_COMMAND = "vexx.git.query";

/** Сколько последних коммитов публикуем ядру для view Graph. */
const LOG_COMMIT_LIMIT = 10;

/**
 * Команды-транспорты мутаций staging (регистрируем мы, зовёт ядро; user-facing
 * `git.*`-команды живут в ядре — одноимённая регистрация перезаписала бы их в
 * CommandRegistry). Аргумент — массив строк-uri; результат — {@link IGitMutationResult}.
 */
const STAGE_COMMAND = "vexx.git.stage";
const UNSTAGE_COMMAND = "vexx.git.unstage";
const CLEAN_COMMAND = "vexx.git.clean";

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

    private refreshTimer: ReturnType<typeof setTimeout> | undefined;
    private gitDirWatcher: fs.FSWatcher | undefined;
    #disposed = false;
    // Метод, а не поле/геттер: результат вызова TS не сужает, поэтому повторные проверки
    // после await не «залипают» (флаг может стать true во время асинхронной паузы).
    private isDisposed(): boolean {
        return this.#disposed;
    }

    // Whether we already logged a degraded git invocation this session (avoid spam).
    private loggedGitFailure = false;

    public constructor(repoRoot: string, gitEnv: NodeJS.ProcessEnv | undefined) {
        this.repoRoot = repoRoot;
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
            vscode.commands.registerCommand(ORIGINAL_RESOURCE_COMMAND, (rawUri: unknown) => {
                if (typeof rawUri !== "string") return null;
                const uri = vscode.Uri.parse(rawUri);
                if (uri.scheme !== "file") return null;
                const absPath = uri.fsPath;
                if (toRepoRelativePath(this.repoRoot, absPath) === null) return null;
                // Untracked: в HEAD версии нет, сравнивать не с чем.
                if (this.status.get(absPath)?.xy.startsWith("?") === true) return null;
                return vscode.Uri.parse(rawUri).with(toGitUri(uri, "HEAD")).toString();
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

        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                this.guard("onDidChangeActiveTextEditor", () => {
                    this.scheduleRefresh();
                });
            }),
        );
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(() => {
                this.guard("onDidSaveTextDocument", () => {
                    this.scheduleRefresh();
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

        this.watchGitDir();

        // The plugin owns its disposables; register a single umbrella disposable.
        context.subscriptions.push({
            dispose: () => {
                this.dispose();
            },
        });

        // Initial paint (async, never throws).
        void this.refreshAll();
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

    private config(): { master: boolean; decorations: boolean; debounce: number } {
        const cfg = vscode.workspace.getConfiguration("git");
        const master = cfg.get<boolean>("enabled", true);
        return {
            master,
            decorations: master && cfg.get<boolean>("decorations.enabled", true),
            debounce: normalizeDebounce(cfg.get<number>("refreshDebounce", 200)),
        };
    }

    private scheduleRefresh(): void {
        if (this.isDisposed()) return;
        if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refreshAll();
        }, this.config().debounce);
    }

    private async refreshAll(): Promise<void> {
        await this.refreshStatus();
        await this.refreshLog();
        await this.refreshRepoState();
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
        void Promise.resolve(vscode.commands.executeCommand(PUBLISH_REPO_STATE_COMMAND, payload)).catch(
            /* v8 ignore next -- best-effort: канал отвалится только при завершении процесса */
            () => undefined,
        );
    }

    /** merge/rebase/cherry-pick по служебным файлам `.git` (как git сам). */
    private detectRepoOpState(): IRepoStatePayload["state"] {
        const gitDir = path.join(this.repoRoot, ".git");
        const exists = (rel: string): boolean => fs.existsSync(path.join(gitDir, rel));
        if (exists("MERGE_HEAD")) return "merging";
        if (exists("rebase-merge") || exists("rebase-apply")) return "rebasing";
        if (exists("CHERRY_PICK_HEAD")) return "cherry-picking";
        return "idle";
    }

    /**
     * Публикует ядру последние коммиты (view Graph). Деградация — пустой
     * список: git недоступен или пустой репозиторий без HEAD (git log выходит
     * ненулевым). Best-effort, как {@link publishChanges}: повторную идентичную
     * публикацию гасит ядро, ошибку канала глотаем.
     */
    private async refreshLog(): Promise<void> {
        if (this.isDisposed()) return;
        const result = await this.git(["log", "-n", String(LOG_COMMIT_LIMIT), ...LOG_FORMAT_ARGS]);
        const commits = result === null ? [] : parseLogZ(result.stdout);
        void Promise.resolve(vscode.commands.executeCommand(PUBLISH_LOG_COMMAND, commits)).catch(
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
            const result = await run(paths);
            if (!result.ok) log(`mutation failed: ${result.message ?? "unknown error"}`);
            await this.refreshAll();
            return result;
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

    // ─── Диспетчер операций (vexx.git.op) ─────────────────────────────────────

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
                default:
                    result = { ok: false, kind: "git-error", message: `unknown git op: ${String(op)}` };
            }
            if (!result.ok) log(`op ${String(op)} failed: ${result.message}`);
            await this.refreshAll();
            return result;
        };
        const next = this.mutationQueue.then(job, job);
        this.mutationQueue = next.catch(() => undefined);
        return next;
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

    // ─── Read-only запросы для пикеров (vexx.git.query) ──────────────────────

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

    /** Run git in the repo; returns a successful result or `null` (degraded — logged once). */
    private async git(args: string[]): Promise<IRunGitResult | null> {
        const opts: IRunGitOptions = { cwd: this.repoRoot };
        if (this.gitEnv !== undefined) opts.env = this.gitEnv;
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

    /** Watch `.git/HEAD` + `.git/index` (via the .git dir) to catch external git ops. */
    private watchGitDir(): void {
        try {
            const gitDir = path.join(this.repoRoot, ".git");
            if (!fs.statSync(gitDir, { throwIfNoEntry: false })?.isDirectory()) return;
            this.gitDirWatcher = fs.watch(gitDir, (_event, filename) => {
                if (filename === "HEAD" || filename === "index" || filename === null) {
                    this.guard("gitDirWatcher", () => {
                        this.scheduleRefresh();
                        // Версии в git: устарели — ядру надо перечитать оригиналы.
                        this.onGitDirChanged?.();
                    });
                }
            });
            // A watcher error (e.g. inotify exhaustion) must not crash the plugin.
            this.gitDirWatcher.on("error", () => undefined);
        } catch {
            // No watcher — refresh still happens on save / editor switch.
        }
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
        this.gitDirWatcher?.close();
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

/** Resolve the enclosing git repository root, or `null` if none/unavailable. */
async function detectRepoRoot(cwd: string, gitEnv: NodeJS.ProcessEnv | undefined): Promise<string | null> {
    const opts: IRunGitOptions = { cwd };
    if (gitEnv !== undefined) opts.env = gitEnv;
    const result = await runGit(["rev-parse", "--show-toplevel"], opts);
    if ("error" in result || result.code !== 0) return null;
    const root = result.stdout.trim();
    return root === "" ? null : root;
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

        const repoRoot = await detectRepoRoot(cwd, gitEnv);
        if (repoRoot === null) {
            log(`not a git repository (or git unavailable): ${cwd}`);
            return;
        }

        log(`git integration active: ${repoRoot}`);
        const decorations = new GitDecorations(repoRoot, gitEnv);
        decorations.start(context);
    } catch (err) {
        // activate() must never throw into the host.
        log(`activate failed: ${String(err)}`);
    }
}
