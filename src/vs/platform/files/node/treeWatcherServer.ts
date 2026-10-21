import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ITreeFileWatcher } from "../common/iTreeFileWatcher.ts";

import type { ITreeWatcherResponse } from "./treeWatcherProtocol.ts";
import { parseTreeWatcherRequest } from "./treeWatcherProtocol.ts";

export interface ITreeWatcherChannel {
    send(message: ITreeWatcherResponse): void;
    onMessage(listener: (message: unknown) => void): void;
}

/** Коалесинг — на этой стороне границы: через IPC едут пачки, а не сотни отдельных событий. */
export function serveTreeWatcher(channel: ITreeWatcherChannel, watcher: ITreeFileWatcher): IDisposable {
    const subscriptions = new Map<number, IDisposable>();

    channel.onMessage((raw) => {
        const request = parseTreeWatcherRequest(raw);
        if (request === null) return;
        if (request.t === "unwatch") {
            subscriptions.get(request.id)?.dispose();
            subscriptions.delete(request.id);
            return;
        }
        const { id } = request;
        subscriptions.set(
            id,
            watcher.watchTree(request.rootPath, request.options, (changes) => {
                channel.send({ t: "changes", id, changes });
            }),
        );
    });

    return {
        dispose: () => {
            for (const subscription of subscriptions.values()) subscription.dispose();
            subscriptions.clear();
        },
    };
}
