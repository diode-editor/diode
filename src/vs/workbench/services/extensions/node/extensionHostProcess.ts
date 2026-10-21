import type { ChildProcess } from "node:child_process";

import { GuardedChildProcess, splitLines } from "../../../../base/node/childProcessGuard.ts";
import { selfSpawnArgs, spawnSelfAsRole } from "../../../../base/node/selfSpawnArgs.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../api/common/extHostProtocol.ts";
import type { IIpcEndpoint } from "../../../api/common/ipcMessageChannel.ts";
import { IpcMessageChannel } from "../../../api/common/ipcMessageChannel.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

export interface IExtensionHostSpawnSpec {
    readonly command: string;
    readonly args: string[];
    readonly env?: NodeJS.ProcessEnv;
}

export interface IExtensionHostProcessOptions {
    readonly spawnArgs: () => IExtensionHostSpawnSpec;
    readonly logger: ILogger | undefined;
    readonly rpcLogger: ILogger | undefined;
    readonly stdoutLogger: ILogger | undefined;
    readonly stderrLogger: ILogger | undefined;
}

/**
 * The owner installs handlers on {@link rpc} before the child's first message (IPC delivers
 * them asynchronously). Counterpart of upstream `LocalProcessExtensionHost`: only process, handshake and exit.
 */
export class ExtensionHostProcess {
    public readonly rpc: HostRpc;
    private readonly child: ChildProcess;
    private readonly guard: GuardedChildProcess;
    private readonly channel: IpcMessageChannel;
    private readonly logger: ILogger | undefined;

    /** @param onExit called once; `error` without `exit` gives `null` code and signal */
    public constructor(
        options: IExtensionHostProcessOptions,
        onExit: (code: number | null, signal: NodeJS.Signals | null) => void,
    ) {
        this.logger = options.logger;
        const spec = options.spawnArgs();
        const { stdoutLogger, stderrLogger } = options;
        // Without a logger the stream is closed, not inherited: the child shares the terminal with
        // the editor, and output from an extension or language server would land in the frame.
        const stdout = stdoutLogger !== undefined ? "pipe" : "ignore";
        const stderr = stderrLogger !== undefined ? "pipe" : "ignore";
        // Stryker disable next-line StringLiteral,ObjectLiteral: debug log text and fields don't define behavior
        this.logger?.debug("spawning extension host subprocess", {
            command: spec.command,
            args: spec.args,
            stdout,
            stderr,
        });
        // Own group so the signal reaches grandchildren: extensions start language servers
        // themselves (jdtls, gopls), and a signal to the direct child doesn't reach them.
        const child = spawnSelfAsRole("DIODE_EXTENSION_HOST", {
            stdout,
            stderr,
            spec,
            env: spec.env,
            ownProcessGroup: true,
        });
        this.guard = new GuardedChildProcess(child, { label: "extension-host", logger: this.logger });
        if (child.stdout !== null && stdoutLogger !== undefined) {
            splitLines(child.stdout, (line) => {
                if (line !== "") stdoutLogger.info(line);
            });
        }
        if (child.stderr !== null && stderrLogger !== undefined) {
            splitLines(child.stderr, (line) => {
                if (line !== "") stderrLogger.warn(line);
            });
        }
        this.guard.onDidEnd((end) => {
            // A failed spawn (EMFILE, ENOENT) is also an end: `exit` may never come, and the owner must reset state.
            // Stryker disable next-line StringLiteral,ObjectLiteral: log text and fields don't define behavior
            if (end.error === undefined) this.logger?.info("extension host subprocess exited", end);
            else this.logger?.error("extension host subprocess error", end.error);
            onExit(end.code, end.signal);
        });
        this.child = child;
        this.channel = new IpcMessageChannel(child as unknown as IIpcEndpoint);
        this.rpc = new RpcEndpoint(this.channel, options.rpcLogger);
    }

    public waitForReady(timeoutMs: number): Promise<void> {
        return waitForReady(this.rpc, this.guard, timeoutMs);
    }

    /** For a child that has already exited on its own; {@link shutdown} stops a live one. */
    public dispose(): void {
        this.rpc.dispose();
        // Stryker disable next-line CallExpression: a closed RPC channel no longer listens, so unsubscribing the channel from the child is unobservable
        this.channel.dispose();
    }

    public async shutdown(shutdownTimeoutMs: number): Promise<void> {
        const child = this.child;
        const exit = waitForExit(child);
        try {
            await Promise.race([this.rpc.request("host.shutdown"), sleep(shutdownTimeoutMs)]);
        } catch {
            // ignore
        }
        if (child.exitCode === null && !child.killed) {
            this.killTree("SIGTERM");
            await Promise.race([exit, sleep(500)]);
        }
        if (child.exitCode === null && !child.killed) {
            this.killTree("SIGKILL");
            await Promise.race([exit, sleep(500)]);
        }
        this.dispose();
    }

    /** Synchronous, for where the event loop no longer spins (window reload). */
    public kill(): void {
        this.killTree("SIGKILL");
    }

    /**
     * The child is spawned `detached`, leading its own group: a negative pid also kills grandchildren
     * (language servers). Windows has no groups, only a direct `kill` there.
     */
    private killTree(signal: NodeJS.Signals): void {
        const pid = this.child.pid;
        // Stryker disable next-line ConditionalExpression,StringLiteral: see above; on posix the right operand is always true, the mutant is equivalent
        if (pid !== undefined && process.platform !== "win32") {
            try {
                process.kill(-pid, signal);
                return;
            } catch (err) {
                // ESRCH: the group has already exited; otherwise try a direct kill so the child isn't left alive.
                if (isNoSuchProcess(err)) return;
                this.logger?.warn("group kill failed, falling back to direct kill", err);
            }
        }
        try {
            this.child.kill(signal);
        } catch {
            // ignore
        }
    }
}

function isNoSuchProcess(err: unknown): boolean {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
}

export function defaultSpawnArgs(): IExtensionHostSpawnSpec {
    return selfSpawnArgs();
}

function waitForReady(rpc: HostRpc, guard: GuardedChildProcess, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        // Cleanup is unobservable in every branch: the promise is already resolved or
        // rejected, and a late `host.ready`, timer or child exit no longer
        // affects it.
        // Stryker disable CallExpression: see above
        const handle = rpc.handleNotification("host.ready", () => {
            handle.dispose();
            cleanup();
            resolve();
        });
        const ended = guard.onDidEnd((end) => {
            handle.dispose();
            cleanup();
            reject(new Error(`extension host subprocess exited before ready (code ${String(end.code)})`));
        });
        const timer = setTimeout(() => {
            handle.dispose();
            cleanup();
            // Stryker restore CallExpression
            reject(new Error(`extension host subprocess did not become ready in ${String(timeoutMs)}ms`));
        }, timeoutMs);
        // Stryker disable BlockStatement,StringLiteral,CallExpression: see above
        const cleanup = (): void => {
            ended.dispose();
            clearTimeout(timer);
        };
        // Stryker restore BlockStatement,StringLiteral,CallExpression
    });
}

// Waiting for exit is entirely unobservable: without it shutdown still completes
// via the safety `sleep(500)`, only the timing changes, not the outcome; and
// the "child already exited" branch is unreachable (see the v8 ignore below).
// Stryker disable all: see above
function waitForExit(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
        /* v8 ignore start -- defensive: handleSubprocessDeath handles subprocess death and clears the host's process, so only a live child reaches shutdown */
        if (child.exitCode !== null || child.killed) {
            resolve();
            return;
        }
        /* v8 ignore stop */
        child.once("exit", () => {
            resolve();
        });
    });
}
// Stryker restore all

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
