import { type ChildProcess, spawn } from "node:child_process";

import { selfSpawnArgs } from "../../../../base/node/selfSpawnArgs.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IIpcEndpoint } from "../../../api/common/ipcMessageChannel.ts";
import { IpcMessageChannel } from "../../../api/common/ipcMessageChannel.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

/** Команда и аргументы запуска субпроцесса ext host'а. */
export interface IExtensionHostSpawnSpec {
    readonly command: string;
    readonly args: string[];
    readonly env?: NodeJS.ProcessEnv;
}

export interface IExtensionHostProcessOptions {
    readonly spawnArgs: () => IExtensionHostSpawnSpec;
    readonly logger: ILogger | undefined;
    /** Трасса RPC-сообщений канала. */
    readonly rpcLogger: ILogger | undefined;
    /** Куда пишется stdout ребёнка построчно; без логгера — `inherit`. */
    readonly stdoutLogger: ILogger | undefined;
    /** Куда пишется stderr ребёнка построчно; без логгера — `inherit`. */
    readonly stderrLogger: ILogger | undefined;
}

/**
 * Один запущенный субпроцесс ext host'а: spawn, stdio, канал и RPC поверх него,
 * ожидание `host.ready` и выключение. Ничего не знает о поверхностях API —
 * обработчики на {@link rpc} ставит владелец (`ExtensionHost`), пока ребёнок
 * ещё не прислал ни одного сообщения (IPC доставляет их асинхронно).
 *
 * Аналог upstream `LocalProcessExtensionHost`
 * (`services/extensions/electron-browser/localProcessExtensionHost.ts`): только
 * процесс, handshake и выход.
 */
export class ExtensionHostProcess {
    public readonly rpc: RpcEndpoint;
    private readonly child: ChildProcess;
    private readonly channel: IpcMessageChannel;
    private readonly logger: ILogger | undefined;

    /**
     * @param onExit ребёнок вышел — сам или по сигналу; зовётся один раз
     */
    public constructor(
        options: IExtensionHostProcessOptions,
        onExit: (code: number | null, signal: NodeJS.Signals | null) => void,
    ) {
        this.logger = options.logger;
        const spec = options.spawnArgs();
        const { stdoutLogger, stderrLogger } = options;
        // Без логгера поток наследуется — ребёнок пишет прямо в наш stdout/stderr.
        const stdio: ["ignore", "pipe" | "inherit", "pipe" | "inherit", "ipc"] = [
            "ignore",
            stdoutLogger !== undefined ? "pipe" : "inherit",
            stderrLogger !== undefined ? "pipe" : "inherit",
            "ipc",
        ];
        // Stryker disable next-line StringLiteral,ObjectLiteral: текст и поля debug-лога поведения не задают
        this.logger?.debug("spawning extension host subprocess", { command: spec.command, args: spec.args, stdio });
        const child = spawn(spec.command, spec.args, {
            stdio,
            env: spec.env ?? { ...process.env, DIODE_EXTENSION_HOST: "1" },
        });
        if (child.stdout !== null && stdoutLogger !== undefined) {
            pipeStreamLines(child.stdout, (line) => {
                stdoutLogger.info(line);
            });
        }
        if (child.stderr !== null && stderrLogger !== undefined) {
            pipeStreamLines(child.stderr, (line) => {
                stderrLogger.warn(line);
            });
        }
        child.once("exit", (code, signal) => {
            // Stryker disable next-line StringLiteral,ObjectLiteral: текст и поля лога поведения не задают
            this.logger?.info("extension host subprocess exited", { code, signal });
            onExit(code, signal);
        });
        child.once("error", (err) => {
            this.logger?.error("extension host subprocess error", err);
        });
        this.child = child;
        this.channel = new IpcMessageChannel(child as unknown as IIpcEndpoint);
        this.rpc = new RpcEndpoint(this.channel, options.rpcLogger);
    }

    /** Ждёт `host.ready`; отказ — ребёнок вышел раньше или не успел за `timeoutMs`. */
    public waitForReady(timeoutMs: number): Promise<void> {
        return waitForReady(this.rpc, this.child, timeoutMs);
    }

    /**
     * Закрывает канал: запросы в полёте получают отказ. Для ребёнка, который
     * уже вышел сам; живого выключает {@link shutdown}.
     */
    public dispose(): void {
        this.rpc.dispose();
        // Stryker disable next-line CallExpression: закрытый RPC канал уже не слушает — отписка канала от ребёнка ненаблюдаема
        this.channel.dispose();
    }

    /**
     * Вежливое прощание: `host.shutdown` (расширения зовут `deactivate()`) с
     * тайм-аутом, затем SIGTERM, затем SIGKILL — каждый следующий шаг только если
     * ребёнок ещё жив. В конце закрывает канал.
     */
    public async shutdown(shutdownTimeoutMs: number): Promise<void> {
        const child = this.child;
        const exit = waitForExit(child);
        try {
            await Promise.race([this.rpc.request("host.shutdown"), sleep(shutdownTimeoutMs)]);
        } catch {
            // ignore
        }
        if (child.exitCode === null && !child.killed) {
            try {
                child.kill("SIGTERM");
            } catch {
                // ignore
            }
            await Promise.race([exit, sleep(500)]);
        }
        if (child.exitCode === null && !child.killed) {
            try {
                child.kill("SIGKILL");
            } catch {
                // ignore
            }
            await Promise.race([exit, sleep(500)]);
        }
        this.dispose();
    }

    /**
     * Синхронно добивает ребёнка сигналом — там, где event loop дальше не
     * крутится (перезагрузка окна). Мёртвому ребёнку `kill` не бросает — просто
     * вернёт false, так что отдельной проверки «а жив ли он» не нужно.
     */
    public kill(): void {
        this.child.kill("SIGKILL");
    }
}

/**
 * Как запустить себя же ext-host'ом. Развилка dev/SEA общая с watcher-процессом
 * и с перезагрузкой окна — живёт в `base/node/selfSpawnArgs.ts`.
 */
export function defaultSpawnArgs(): IExtensionHostSpawnSpec {
    return selfSpawnArgs();
}

function waitForReady(rpc: RpcEndpoint, child: ChildProcess, timeoutMs: number): Promise<void> {
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
        const onExit = (code: number | null): void => {
            handle.dispose();
            cleanup();
            reject(new Error(`extension host subprocess exited before ready (code ${String(code)})`));
        };
        const timer = setTimeout(() => {
            handle.dispose();
            cleanup();
            // Stryker restore CallExpression
            reject(new Error(`extension host subprocess did not become ready in ${String(timeoutMs)}ms`));
        }, timeoutMs);
        // Stryker disable BlockStatement,StringLiteral,CallExpression: см. выше
        const cleanup = (): void => {
            child.off("exit", onExit);
            clearTimeout(timer);
        };
        // Stryker restore BlockStatement,StringLiteral,CallExpression
        child.once("exit", onExit);
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

/**
 * Линейно-буферизованная подписка на `Readable` (stdout/stderr subprocess'а).
 * Каждую полную непустую строку (`\n`-delimited) отдаёт `write`. Хвост без
 * `\n` сбрасывает при `end`.
 */
function pipeStreamLines(stream: NodeJS.ReadableStream, write: (line: string) => void): void {
    // Декодирует поток сам, а не по чанку: многобайтный символ, разрезанный
    // между чанками, иначе превратился бы в мусор.
    // Stryker disable next-line StringLiteral: пустая кодировка у Node — тот же utf8
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk: string) => {
        buffer += chunk;
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (line.length > 0) write(line);
            nl = buffer.indexOf("\n");
        }
    });
    // После `end` данных уже не будет — хвост отдаём, буфер больше не нужен.
    stream.on("end", () => {
        if (buffer.length > 0) write(buffer);
    });
}
