import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { GuardedChildProcess } from "../../../base/node/childProcessGuard.ts";
import { spawnSelfAsRole } from "../../../base/node/selfSpawnArgs.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import type { ITreeFileChange, ITreeFileWatcher, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

import type { ITreeWatcherRequest } from "./treeWatcherProtocol.ts";
import { parseTreeWatcherResponse } from "./treeWatcherProtocol.ts";

/**
 * Deaths **in a row** before giving up on watching: the process has nothing to crash on (chokidar
 * catches its own errors), so a streak means a broken environment, and endless respawns are worse
 * than an honest "no watching".
 */
const DEFAULT_MAX_RESTARTS = 3;

/** After living this long, the process resets the death counter, otherwise "in a row" would become "per session". */
const HEALTHY_UPTIME_MS = 60_000;

export interface IWatcherProcess {
    send(message: ITreeWatcherRequest): void;
    onMessage(listener: (message: unknown) => void): void;
    onExit(listener: () => void): void;
    /**
     * Separate from {@link onExit}: a failed spawn may never emit `exit`, and an EventEmitter
     * `error` without a listener throws, killing the editor.
     */
    onError(listener: (error: unknown) => void): void;
    /** Synchronous. */
    kill(): void;
}

export interface ISubprocessTreeWatcherOptions {
    readonly logger?: ILogger;
    readonly spawnProcess?: () => IWatcherProcess;
    readonly maxRestarts?: number;
    readonly now?: () => number;
}

interface IWatchRequest {
    readonly rootPath: string;
    readonly options: ITreeFileWatchOptions;
    readonly onChanges: (changes: readonly ITreeFileChange[]) => void;
}

/**
 * Tree walking runs in a **separate process** (like VS Code's `--type=fileWatcher`):
 * recursive `readdir`+`stat`+inotify is seconds of work, and on the main loop it
 * cost hundreds of ms of responsiveness when opening a file in a large repository.
 *
 * Not `worker_threads`: its `stat` calls share the libuv threadpool (4 threads)
 * with reads of files being opened, so the walk would starve file opening. A process
 * has its own threadpool and heap.
 *
 * The process starts lazily, on the first `watchTree`: spawning at startup would only
 * move the delay. Deduplication (`SharedTreeWatcher`) lives inside the process.
 * Child death and a failed spawn take the same branch: restart and re-subscribe,
 * and after a streak, "no watching"; it must never crash the editor.
 */
export class SubprocessTreeWatcher implements ITreeFileWatcher {
    private readonly logger: ILogger | undefined;
    private readonly spawnProcess: () => IWatcherProcess;
    private readonly maxRestarts: number;
    private readonly now: () => number;
    private readonly requests = new Map<number, IWatchRequest>();
    private child: IWatcherProcess | null = null;
    private childStartedAt = 0;
    private nextId = 1;
    private restarts = 0;
    private gaveUp = false;
    private disposed = false;

    public constructor(options: ISubprocessTreeWatcherOptions = {}) {
        this.logger = options.logger;
        this.spawnProcess = options.spawnProcess ?? (() => spawnWatcherProcess(this.logger));
        this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
        this.now = options.now ?? Date.now;
    }

    public watchTree(
        rootPath: string,
        options: ITreeFileWatchOptions,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable {
        const id = this.nextId++;
        this.requests.set(id, { rootPath, options, onChanges });
        // Sending to a just-spawned process is fine: node buffers IPC until the
        // first reader and delivers in send order.
        this.ensureProcess()?.send({ t: "watch", id, rootPath, options });
        return {
            dispose: () => {
                if (!this.requests.delete(id)) return;
                this.child?.send({ t: "unwatch", id });
                // Don't kill the process on the last unsubscribe: idle it costs nothing,
                // and the next request would otherwise pay for a new spawn.
            },
        };
    }

    /**
     * Synchronous, for window reload: the supervisor then blocks in `spawnSync`, and a
     * watcher left alive would outlive the window, holding inotify watches next to the new ones.
     */
    public dispose(): void {
        this.disposed = true;
        // Otherwise a batch already in the channel would reach the subscriber after disposal.
        this.requests.clear();
        this.child?.kill();
        this.child = null;
    }

    /** `null` means watching is over. */
    private ensureProcess(): IWatcherProcess | null {
        if (this.child !== null) return this.child;
        if (this.disposed || this.gaveUp) return null;
        return this.startProcess();
    }

    private startProcess(): IWatcherProcess {
        this.logger?.debug("spawning file watcher process");
        const child = this.spawnProcess();
        child.onMessage((message) => {
            this.handleMessage(message);
        });
        child.onExit(() => {
            this.handleExit(child);
        });
        child.onError((error) => {
            this.handleChildError(child, error);
        });
        this.child = child;
        this.childStartedAt = this.now();
        return child;
    }

    private handleMessage(raw: unknown): void {
        const message = parseTreeWatcherResponse(raw);
        if (message === null) return;
        if (message.t === "log") {
            this.logger?.[message.level](message.message, ...message.args);
            return;
        }
        // The batch may have overtaken an already sent `unwatch`: nobody to deliver to.
        this.requests.get(message.id)?.onChanges(message.changes);
    }

    /**
     * Two real paths: `send()` into a dead process's channel (`ERR_IPC_CHANNEL_CLOSED`
     * arrives later as an event, `try/catch` around `send` doesn't help) and a failed
     * spawn (`EMFILE`/`EAGAIN`, `ENOENT`), after which `exit` may never come; without
     * this branch the proxy would hold a dead reference forever.
     */
    private handleChildError(child: IWatcherProcess, error: unknown): void {
        if (this.child !== child) return;
        this.logger?.warn("file watcher process error", {
            code: (error as NodeJS.ErrnoException | undefined)?.code,
            error: String(error),
        });
        this.handleExit(child);
    }

    /** Events during a restart are lost; we log that. */
    private handleExit(child: IWatcherProcess): void {
        // A late exit of a retired process (including one right after a handled `error`) leaves the new one alone.
        if (this.child !== child) return;
        this.child = null;
        if (this.disposed || this.requests.size === 0) return;
        if (this.now() - this.childStartedAt >= HEALTHY_UPTIME_MS) this.restarts = 0;
        if (this.restarts >= this.maxRestarts) {
            this.gaveUp = true;
            this.logger?.error("file watcher process keeps dying; file watching is disabled for this session", {
                restarts: this.restarts,
                requests: this.requests.size,
            });
            return;
        }
        this.restarts++;
        this.logger?.warn("file watcher process died; restarting and re-subscribing", {
            restart: this.restarts,
            requests: this.requests.size,
        });
        const restarted = this.startProcess();
        for (const [id, request] of this.requests) {
            restarted.send({ t: "watch", id, rootPath: request.rootPath, options: request.options });
        }
    }
}

/** `main.ts` kills it on window reload. */
// Stryker disable next-line StringLiteral: the token id is only a name in container diagnostics
// ("No binding for …", dependency cycle); binding resolution depends on object identity.
export const SubprocessTreeWatcherDIToken = token<SubprocessTreeWatcher>("SubprocessTreeWatcher");

/** The child's stdout is closed: it shares the terminal with the editor, and stray output would corrupt the frame. */
function spawnWatcherProcess(logger: ILogger | undefined): IWatcherProcess {
    const child = spawnSelfAsRole("DIODE_FILE_WATCHER", { stderr: "pipe" });
    const guard = new GuardedChildProcess(child, { label: "file-watcher", logger, logStderr: true });
    return {
        send: (message) => {
            // Catches only a synchronous throw; the async ERR_IPC_CHANNEL_CLOSED goes to onError.
            try {
                child.send(message);
            } catch {
                /* no-op */
            }
        },
        onMessage: (listener) => {
            child.on("message", listener);
        },
        onExit: (listener) => {
            guard.onDidEnd((end) => {
                // Stryker disable next-line ConditionalExpression: on an error end onError has already handled the death (handleChildError → handleExit), and a second handleExit is a no-op via the process check
                if (end.error === undefined) listener();
            });
        },
        onError: (listener) => {
            guard.onDidEnd((end) => {
                // Stryker disable next-line ConditionalExpression: on a clean exit onExit (subscribed earlier) has already retired the process, and handleChildError returns at the process check
                if (end.error !== undefined) listener(end.error);
            });
        },
        kill: () => {
            guard.dispose();
        },
    };
}
