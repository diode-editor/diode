import type { ILogger } from "../../log/common/iLogger.ts";

import { ChokidarTreeWatcher } from "./chokidarTreeWatcher.ts";
import { SharedTreeWatcher } from "./sharedTreeWatcher.ts";
import type { ITreeWatcherResponse, TreeWatcherLogLevel } from "./treeWatcherProtocol.ts";
import { serveTreeWatcher } from "./treeWatcherServer.ts";

/** Returns immediately; the process lives on the IPC channel until `disconnect` (editor death) or a signal. */
export function runTreeWatcherSubprocess(): void {
    const send = process.send?.bind(process);
    if (send === undefined) {
        console.error("[file-watcher] subprocess started without IPC channel; exiting");
        process.exit(2);
    }

    // The env role must not leak to children, otherwise a process spawned from here would take
    // this same branch. As with the extension host, set node as the inherited mode, which
    // `main.ts` checks FIRST.
    delete process.env.DIODE_FILE_WATCHER;
    process.env.DIODE_RUN_AS_NODE = "1";

    const post = (message: ITreeWatcherResponse): void => {
        // A closed channel is no reason to crash: `disconnect` leads to exit anyway.
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
 * `isEnabled` is always `true`: log settings live in the editor, which does the filtering.
 * Volume stays small: the watcher logs per subscription and error, not per file event.
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
