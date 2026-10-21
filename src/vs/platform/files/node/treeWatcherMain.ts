import type { ILogger } from "../../log/common/iLogger.ts";

import { ChokidarTreeWatcher } from "./chokidarTreeWatcher.ts";
import { SharedTreeWatcher } from "./sharedTreeWatcher.ts";
import type { ITreeWatcherResponse, TreeWatcherLogLevel } from "./treeWatcherProtocol.ts";
import { serveTreeWatcher } from "./treeWatcherServer.ts";

/** Возвращается сразу; процесс живёт на IPC-канале до `disconnect` (смерти редактора) или сигнала. */
export function runTreeWatcherSubprocess(): void {
    const send = process.send?.bind(process);
    if (send === undefined) {
        console.error("[file-watcher] subprocess started without IPC channel; exiting");
        process.exit(2);
    }

    // Env-роль не должна протекать детям: иначе заведённый отсюда процесс ушёл бы
    // в эту же ветку. Как у extension host'а — наследуемым режимом ставим node,
    // который `main.ts` проверяет ПЕРВЫМ.
    delete process.env.DIODE_FILE_WATCHER;
    process.env.DIODE_RUN_AS_NODE = "1";

    const post = (message: ITreeWatcherResponse): void => {
        // Закрытый канал — не повод падать: `disconnect` и так уводит в exit.
        try {
            send(message);
        } catch {
            /* no-op */
        }
    };

    const logger = createForwardingLogger(post);
    const server = serveTreeWatcher(
        {
            send: post,
            onMessage: (listener) => {
                process.on("message", listener);
            },
        },
        new SharedTreeWatcher(new ChokidarTreeWatcher(logger), logger),
    );

    process.on("disconnect", () => {
        server.dispose();
        process.exit(0);
    });

    logger.info("file watcher process started", { pid: process.pid });
}

/**
 * `isEnabled` всегда `true`: настройки логов у редактора, он и отфильтрует.
 * Объём не раздувается — watcher пишет на подписку и ошибку, не на событие файла.
 */
function createForwardingLogger(post: (message: ITreeWatcherResponse) => void): ILogger {
    const at =
        (level: TreeWatcherLogLevel) =>
        (message: string, ...args: unknown[]): void => {
            post({ t: "log", level, message, args });
        };
    return {
        trace: at("trace"),
        debug: at("debug"),
        info: at("info"),
        warn: at("warn"),
        error: at("error"),
        isEnabled: () => true,
    };
}
