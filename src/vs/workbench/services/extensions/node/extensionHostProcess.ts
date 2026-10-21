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
 * Обработчики на {@link rpc} владелец ставит до первого сообщения ребёнка (IPC доставляет
 * их асинхронно). Аналог upstream `LocalProcessExtensionHost`: только процесс, handshake и выход.
 */
export class ExtensionHostProcess {
    public readonly rpc: HostRpc;
    private readonly child: ChildProcess;
    private readonly guard: GuardedChildProcess;
    private readonly channel: IpcMessageChannel;
    private readonly logger: ILogger | undefined;

    /** @param onExit зовётся один раз; `error` без `exit` — код и сигнал `null` */
    public constructor(
        options: IExtensionHostProcessOptions,
        onExit: (code: number | null, signal: NodeJS.Signals | null) => void,
    ) {
        this.logger = options.logger;
        const spec = options.spawnArgs();
        const { stdoutLogger, stderrLogger } = options;
        // Без логгера поток закрыт, а не наследуется: ребёнок делит терминал с
        // редактором, и печать расширения или language-сервера попала бы в кадр.
        const stdout = stdoutLogger !== undefined ? "pipe" : "ignore";
        const stderr = stderrLogger !== undefined ? "pipe" : "ignore";
        // Stryker disable next-line StringLiteral,ObjectLiteral: текст и поля debug-лога поведения не задают
        this.logger?.debug("spawning extension host subprocess", {
            command: spec.command,
            args: spec.args,
            stdout,
            stderr,
        });
        // Своя группа — чтобы сигнал доставал внуков: языковые серверы поднимают сами
        // расширения (jdtls, gopls), сигнал прямому ребёнку их не касается.
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
            // Неудачный спавн (EMFILE, ENOENT) — тоже конец: `exit` может не прийти, а владелец обязан сбросить состояние.
            // Stryker disable next-line StringLiteral,ObjectLiteral: текст и поля лога поведения не задают
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

    /** Для ребёнка, который уже вышел сам; живого выключает {@link shutdown}. */
    public dispose(): void {
        this.rpc.dispose();
        // Stryker disable next-line CallExpression: закрытый RPC канал уже не слушает — отписка канала от ребёнка ненаблюдаема
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

    /** Синхронно — там, где event loop дальше не крутится (перезагрузка окна). */
    public kill(): void {
        this.killTree("SIGKILL");
    }

    /**
     * Ребёнок запущен `detached` — лидер своей группы: отрицательный pid снимает и внуков
     * (языковые серверы). На Windows групп нет, там только прямой `kill`.
     */
    private killTree(signal: NodeJS.Signals): void {
        const pid = this.child.pid;
        // Stryker disable next-line ConditionalExpression,StringLiteral: см. выше — на posix правый операнд всегда истинен, мутант эквивалентен
        if (pid !== undefined && process.platform !== "win32") {
            try {
                process.kill(-pid, signal);
                return;
            } catch (err) {
                // ESRCH — группа уже вышла; иное — пробуем прямой kill, чтобы не оставить ребёнка живым.
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
        // Уборка ненаблюдаема ни в одной ветке: промис уже разрешён или
        // отклонён, и поздние `host.ready`/таймер/выход ребёнка в нём ничего не
        // меняют.
        // Stryker disable CallExpression: см. выше
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
        // Stryker disable BlockStatement,StringLiteral,CallExpression: см. выше
        const cleanup = (): void => {
            ended.dispose();
            clearTimeout(timer);
        };
        // Stryker restore BlockStatement,StringLiteral,CallExpression
    });
}

// Ожидание выхода ненаблюдаемо целиком: без него выключение всё равно доходит
// до конца по страховочному `sleep(500)` — меняется только время, не исход; а
// ветка «ребёнок уже вышел» недостижима (см. v8 ignore ниже).
// Stryker disable all: см. выше
function waitForExit(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
        /* v8 ignore start -- defensive: смерть субпроцесса разбирает handleSubprocessDeath, и он обнуляет процесс хоста; поэтому до shutdown доезжает только живой ребёнок */
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
