import type { IDisposable } from "@tuidom/core/common/disposable";

import type { ITreeFileWatcher } from "../common/iTreeFileWatcher.ts";

import type { ITreeWatcherResponse } from "./treeWatcherProtocol.ts";
import { parseTreeWatcherRequest } from "./treeWatcherProtocol.ts";

/** Канал к редактору глазами watcher-процесса (в бою — его IPC). */
export interface ITreeWatcherChannel {
    send(message: ITreeWatcherResponse): void;
    onMessage(listener: (message: unknown) => void): void;
}

/**
 * Серверная половина watcher-процесса: превращает поток сообщений редактора в
 * вызовы настоящего {@link ITreeFileWatcher} и отправляет его пачки обратно.
 *
 * Коалесинг остаётся **внутри** watcher'а, то есть на этой стороне границы:
 * через IPC едут пачки, а не отдельные события. Иначе одна пользовательская
 * операция (checkout, `npm install`) вернула бы на главный цикл редактора
 * сотни разборов сообщений — ту самую нагрузку, которую процесс и снимает.
 *
 * Отдельно от `runTreeWatcherSubprocess`, чтобы проверяться без процесса:
 * здесь нет ни `process`, ни chokidar — только канал и интерфейс watcher'а.
 */
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
