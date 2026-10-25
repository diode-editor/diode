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
import { fromGitUri, GIT_SCHEME, gitRefOf, ORIGINAL_RESOURCE_COMMAND, toGitUri } from "./lib/gitUri.ts";
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
 * Any bad environment (no workspace/repo/binary, non-zero exit) degrades to
 * "no decorations" plus one log line: {@link runGit} never rejects and handlers
 * are guarded, so nothing reaches the host.
 */

function log(message: string): void {
    // Subprocess stdout goes to the `extensions.host.stdout` log, not to the TUI pty.
    console.log(`[git] ${message}`);
}

// Core command ids are duplicated as strings: no shared imports across the process boundary.
const PUBLISH_CHANGES_COMMAND = "diode.scm.publishChanges";

const PUBLISH_LOG_COMMAND = "diode.scm.publishLog";
/**
 * While the GRAPH section is collapsed, `git log` never runs. Asked once on
 * activation; after that the core sends `logSetEnabled`.
 */
const GRAPH_ENABLED_COMMAND = "diode.scm.graphEnabled";

const PUBLISH_REPO_STATE_COMMAND = "diode.scm.publishRepoState";

const QUERY_COMMAND = "diode.git.query";

/** As in vscode: `scm.graph.pageSize` defaults to 50, capped at 1000. */
const LOG_PAGE_SIZE_DEFAULT = 50;
const LOG_PAGE_SIZE_MAX = 1000;

/**
 * Not `git.*`: user-facing commands live in the core, and a registration with the same
 * name would overwrite them in CommandRegistry. The argument is an array of uri strings.
 */
const STAGE_COMMAND = "diode.git.stage";
const UNSTAGE_COMMAND = "diode.git.unstage";
const CLEAN_COMMAND = "diode.git.clean";

interface IGitMutationResult {
    readonly ok: boolean;
    /** First stderr line, when `ok: false`. */
    readonly message?: string;
}

interface IStatusEntry {
    readonly xy: string;
    /** Relative to the repository root, always `/`-separated. */
    readonly relPath: string;
    /** For a rename, the original path ({@link pathAtHead}). */
    readonly headRelPath: string;
    readonly deco: IStatusDecoration;
}

class GitDecorations {
    private readonly repoRoot: string;
    private readonly dotGit: IDotGit;
    private readonly gitEnv: NodeJS.ProcessEnv | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    /** Keyed by absolute path. */
    private status = new Map<string, IStatusEntry>();
    private readonly fileDecoEmitter = new vscode.EventEmitter<vscode.Uri[]>();
    private readonly fileChangeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private onGitDirChanged: (() => void) | undefined;

    /** 0 means the default page size (from the setting). */
    private logLimit = 0;
    /**
     * Defaults to "needed": otherwise a core without the `graphEnabled` channel would keep
     * an empty graph forever. The real value arrives in {@link pullGraphEnabled}.
     */
    private logEnabled = true;
    /** Second ref of the graph history (vscode `auto` mode). */
    private upstreamRef: string | null = null;

    private refreshTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * While non-zero, file events don't trigger a refresh: `git status` would fight the
     * operation for `.git/index.lock`, and the operation ends with its own refreshAll.
     */
    private pendingMutations = 0;
    /** Recreated on every state snapshot: the upstream changes with the branch. */
    private upstreamWatcher: vscode.Disposable | undefined;
    private upstreamWatchedRef: string | null = null;
    #disposed = false;
    // A method, not a field/getter: TS doesn't narrow a call result, so checks after
    // await don't get stuck.
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
     * Like `GitFileSystemProvider` in VS Code. `onDidChangeFile` fires only for resources
     * already read: those are exactly what the consumer caches.
     */
    private registerFileSystemProvider(): void {
        const served = new Map<string, vscode.Uri>();
        this.disposables.push(this.fileChangeEmitter);
        // The command goes BEFORE the scheme provider: the core recomputes bars when the
        // provider appears, and without the command the first frame would lack bars until the first edit.
        this.disposables.push(
            vscode.commands.registerCommand(ORIGINAL_RESOURCE_COMMAND, (rawUri: unknown, rawRef?: unknown) => {
                if (typeof rawUri !== "string") return null;
                const uri = vscode.Uri.parse(rawUri);
                if (uri.scheme !== "file") return null;
                const absPath = uri.fsPath;
                if (toRepoRelativePath(this.repoRoot, absPath) === null) return null;
                const ref = gitRefOf(rawRef);
                // Working tree status says nothing about an arbitrary ref, so untracked
                // files and renames count only for HEAD.
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
                            // Untracked/new/deleted is a normal case, not a failure.
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

        // The watcher sees saves too, but this subscription is faster and more deterministic.
        // Active editor changes are deliberately NOT tracked: the disk doesn't change, and `git status`
        // per tab is an idle RPC storm.
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
        // The extension builds argv; the core deals in operation names.
        this.disposables.push(
            vscode.commands.registerCommand(GIT_OP_COMMAND, (payload: unknown) => this.enqueueOp(payload)),
        );
        // Bypasses the mutation queue.
        this.disposables.push(
            vscode.commands.registerCommand(QUERY_COMMAND, (payload: unknown) => this.query(payload)),
        );

        this.startWatchers();

        context.subscriptions.push({
            dispose: () => {
                this.dispose();
            },
        });

        // GRAPH expansion state comes before the first refresh: otherwise `git log` runs even for a collapsed section.
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

    private cancelScheduledRefresh(): void {
        if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
    }

    private scheduleRefresh(): void {
        if (this.isDisposed()) return;
        this.cancelScheduledRefresh();
        const debounce = this.config().debounce;
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            // Counterpart of VS Code `whenIdleAndFocused`: `git status` would fight the
            // mutation for `.git/index.lock`.
            if (this.pendingMutations > 0) {
                this.scheduleRefresh();
                return;
            }
            void this.refreshAll();
        }, debounce);
    }

    /** Repository state goes before the log: it provides the upstream, the second ref of {@link refreshLog}. */
    private async refreshAll(): Promise<void> {
        await this.refreshStatus();
        await this.refreshRepoState();
        if (this.logEnabled) await this.refreshLog();
    }

    /** `undefined` means the core doesn't know the channel (old build, harness): keep "history needed". */
    private async pullGraphEnabled(): Promise<void> {
        try {
            const answer = await vscode.commands.executeCommand(GRAPH_ENABLED_COMMAND);
            this.logEnabled = answer !== false;
            /* v8 ignore next 3 -- best-effort: the channel fails only on process exit */
        } catch {
            // Channel unavailable: keep the default.
        }
    }

    private async refreshRepoState(): Promise<void> {
        if (this.isDisposed()) return;
        const status = await this.git(["status", "--porcelain=v2", "--branch"]);
        if (status === null) return; // the core keeps the previous snapshot
        const remotes = await this.git(["remote"]);

        const payload: IRepoStatePayload = {
            ...parseBranchHeaders(status.stdout),
            remotes: remotes === null ? [] : parseRemotes(remotes.stdout),
            state: this.detectRepoOpState(),
        };
        this.upstreamRef = payload.upstream;
        this.updateUpstreamWatcher(payload.upstream);
        void Promise.resolve(vscode.commands.executeCommand(PUBLISH_REPO_STATE_COMMAND, payload)).catch(
            /* v8 ignore next -- best-effort: the channel fails only on process exit */
            () => undefined,
        );
    }

    /** From `.git` state files, as git itself does. */
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
     * vscode `auto` mode: the branch plus its upstream. Without `--ignore-missing` a vanished
     * upstream ref gives a non-zero exit and empties the whole graph.
     */
    private logRefArgs(): string[] {
        const refs = ["HEAD"];
        if (this.upstreamRef !== null && this.upstreamRef !== "") refs.push(this.upstreamRef);
        return ["--ignore-missing", ...refs];
    }

    /** The extra commit past the limit isn't shown; it only tells whether to render "Load More…". */
    private async refreshLog(): Promise<void> {
        if (this.isDisposed()) return;
        const limit = this.currentLogLimit();
        const result = await this.git(["log", "-n", String(limit + 1), ...LOG_FORMAT_ARGS, ...this.logRefArgs()]);
        const page = result === null ? [] : parseLogZ(result.stdout);
        const hasMore = page.length > limit;
        const payload = { commits: hasMore ? page.slice(0, limit) : page, hasMore };
        void Promise.resolve(vscode.commands.executeCommand(PUBLISH_LOG_COMMAND, payload)).catch(
            /* v8 ignore next -- best-effort: the channel fails only on process exit */
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
        // old ∪ new, so decorations are cleared from files that went away too.
        const affected = new Set<string>([...previous, ...next.keys()]);
        if (affected.size > 0 && !this.isDisposed()) {
            this.fileDecoEmitter.fire([...affected].map((p) => vscode.Uri.file(p)));
        }
        this.publishChanges(next);
    }

    /** Sent unconditionally: the core (`ScmChangesService`) drops an identical republish. */
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
            /* v8 ignore next -- best-effort: the channel fails only on process exit */
            () => undefined,
        );
    }

    /**
     * Strictly one at a time: concurrent `add`/`reset`/`checkout` fight over
     * `.git/index.lock` (and with the background `git status`, which writes the index too).
     */
    private mutationQueue: Promise<unknown> = Promise.resolve();

    /** Refreshes immediately, bypassing debounce; the core dedups the duplicate from the `.git` watcher. */
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

    /** The payload crosses the process boundary: garbage and paths outside the repository are silently dropped. */
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

    /** With an unborn HEAD, reset fails with "ambiguous argument 'HEAD'"; fall back to `rm --cached`. */
    private async unstage(paths: string[]): Promise<IGitMutationResult> {
        const result = await this.mutate(["reset", "-q", "HEAD", "--", ...paths]);
        if (!result.ok && (result.message?.includes("ambiguous argument 'HEAD'") ?? false)) {
            return this.mutate(["rm", "--cached", "-r", "-q", "--", ...paths]);
        }
        return result;
    }

    /** Tracked vs untracked comes from the last `git status` snapshot. */
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

    /** Shares the mutation queue: same `.git/index.lock`. A garbage payload yields `{ok: false}`, not an exception. */
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
                    // Not a mutation, but goes through the shared queue: the page reaches the core
                    // via refreshAll at the end of the operation. Same for logLoadMore.
                    this.logEnabled = opParams.enabled === true;
                    result = { ok: true };
                    break;
                case "logLoadMore":
                    this.logLimit = this.currentLogLimit() + this.logPageSize();
                    result = { ok: true };
                    break;
                case "refresh":
                    // The core's `git.refresh`: the work is the refreshAll every op ends with. A pending
                    // watcher debounce would only repeat it right after.
                    this.cancelScheduledRefresh();
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
                    // Like VS Code: fetch the new remote right away (best-effort).
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

    /** Like VS Code, merge and root commits aren't undone; the core puts the message back into the commit input box. */
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

    /** `null` from a builder means invalid parameters. */
    private runBuilt(args: string[] | null, opts?: { network?: boolean }): Promise<GitOpResult> {
        if (args === null) {
            return Promise.resolve({ ok: false, kind: "git-error", message: "invalid git op parameters" });
        }
        return this.runOp(args, opts);
    }

    /** Network ops get `GIT_TERMINAL_PROMPT=0`: there is no tty, so a credentials prompt must quickly become an `auth` error. */
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

    /** Without the degradation logging of {@link git}. */
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
     * `null` means degradation, logged once. `GIT_OPTIONAL_LOCKS=0`: otherwise the background
     * `git status` takes `.git/index.lock`, and the user's `git add` fails with
     * "Unable to create index.lock". The cost: status doesn't cache stat info in the index.
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
     * VS Code layout (`Repository` in `extensions/git/src/repository.ts`): the whole working
     * tree, or an edit from a terminal stays unseen until the next event; the top level of
     * `.git` for checkout/commit/stage/merge; the common dir for an outside fetch.
     * A `.git` event also invalidates `git:` versions, or bars would be computed against a stale HEAD.
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
     * An outside `git fetch` touches `refs/remotes/<remote>/<branch>`, deeper than the top
     * level of `.git`. Watch the **directory** with an exact name, not the file: git writes
     * the ref with an atomic `rename`, so a watch on the original file's inode is dead.
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

    /** VS Code gates (`Repository.onFileChange`). */
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

/** A single `rev-parse`: the root and `.git` must be consistent. */
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
