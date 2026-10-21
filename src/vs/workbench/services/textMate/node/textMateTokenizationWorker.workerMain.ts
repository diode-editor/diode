import { parentPort } from "node:worker_threads";

import { describeRejection } from "../../../../base/common/describeRejection.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import type {
    IMessagePort,
    MainToWorkerMessage,
    WorkerToMainMessage,
} from "../common/backgroundTokenization/textMateWorkerProtocol.ts";
import { TextMateTokenizationWorker } from "../common/backgroundTokenization/worker/textMateTokenizationWorker.ts";

/**
 * Вход воркера фоновой токенизации (upstream
 * `textMateTokenizationWorker.workerMain.ts`) — и вход ленивого куска
 * `roles/textmate-worker` (`scripts/build-lazy-chunks.mjs`): главный поток
 * поднимает `worker_threads` с кодом куска и зовёт эту функцию
 * (`textMateWorkerSpawner.ts`). Верхний уровень модуля пуст — кусок
 * исполняется и при снятии кэша кода на сборке.
 */
export function runTextMateTokenizationWorker(): void {
    const port = parentPort;
    if (port === null) throw new Error("TextMate worker: not running in a worker thread");
    const channel: IMessagePort<MainToWorkerMessage, WorkerToMainMessage> = {
        postMessage: (message, transfer) => {
            port.postMessage(message, transfer === undefined ? [] : [...transfer]);
        },
        onMessage: (listener) => {
            port.on("message", listener);
            return {
                dispose: () => {
                    port.off("message", listener);
                },
            };
        },
    };
    // Свой console у воркера пишет в stdout процесса — поверх кадра TUI.
    setUnexpectedErrorHandler((error) => {
        channel.postMessage({ type: "unexpectedError", message: describeRejection(error) });
    });
    new TextMateTokenizationWorker(channel);
}
