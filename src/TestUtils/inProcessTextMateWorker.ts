import { MessageChannel } from "node:worker_threads";

import { joinVirtualPath } from "../vs/base/common/assets/assetBundleFormat.ts";
import type { IAssetAccess } from "../vs/base/common/assets/iAssetAccess.ts";
import { Emitter } from "../vs/base/common/event.ts";
import { scanBuiltinExtensions } from "../vs/platform/extensions/common/extensionScanner.ts";
import type {
    MainToWorkerMessage,
    WorkerToMainMessage,
} from "../vs/workbench/services/textMate/common/backgroundTokenization/textMateWorkerProtocol.ts";
import type {
    ITextMateWorkerConnection,
    TextMateWorkerSpawner,
} from "../vs/workbench/services/textMate/common/backgroundTokenization/threadedBackgroundTokenizerFactory.ts";
import { TextMateTokenizationWorker } from "../vs/workbench/services/textMate/common/backgroundTokenization/worker/textMateTokenizationWorker.ts";
import type { IGrammarRecord } from "../vs/workbench/services/textMate/common/textMateGrammarLoader.ts";

/** Записи грамматик встроенных расширений — как их собирает `ExtensionTokenizationContributor`. */
export async function builtinGrammarRecords(assets: IAssetAccess): Promise<IGrammarRecord[]> {
    const records: IGrammarRecord[] = [];
    for (const ext of await scanBuiltinExtensions(assets, "Extensions/builtin/")) {
        for (const grammar of ext.manifest.contributes?.grammars ?? []) {
            records.push({
                scopeName: grammar.scopeName,
                path: joinVirtualPath(ext.location, grammar.path),
                injections: grammar.injectTo,
            });
        }
    }
    return records;
}

export interface IInProcessTextMateWorker {
    readonly spawn: TextMateWorkerSpawner;
    /** Сколько раз фабрика поднимала воркер. */
    readonly spawned: () => number;
    /** Сообщения главного потока воркеру — по порядку, все запуски. */
    readonly sent: MainToWorkerMessage[];
    /** Уронить последний поднятый воркер (как `error`/`exit` у `worker_threads`). */
    crash(error?: unknown): void;
    dispose(): void;
}

/**
 * Воркер фоновой токенизации в том же потоке, что и тест: тот же
 * {@link TextMateTokenizationWorker} на втором конце `MessageChannel` — то
 * есть настоящие структурное клонирование и `transfer`, асинхронная доставка
 * и порядок сообщений, без `worker_threads` и загрузчика tsx в нём.
 */
export function createInProcessTextMateWorker(): IInProcessTextMateWorker {
    const sent: MainToWorkerMessage[] = [];
    const live: { channel: MessageChannel; worker: TextMateTokenizationWorker; fail: Emitter<unknown> }[] = [];
    let count = 0;

    const close = (entry: (typeof live)[number]): void => {
        entry.worker.dispose();
        entry.channel.port1.close();
        entry.channel.port2.close();
    };

    const spawn: TextMateWorkerSpawner = () => {
        count++;
        const channel = new MessageChannel();
        const workerPort = channel.port2;
        const worker = new TextMateTokenizationWorker({
            postMessage: (message, transfer) => {
                workerPort.postMessage(message, transfer === undefined ? [] : [...transfer]);
            },
            onMessage: (listener) => {
                const handler = (message: MainToWorkerMessage): void => {
                    listener(message);
                };
                workerPort.on("message", handler);
                return {
                    dispose: () => {
                        workerPort.off("message", handler);
                    },
                };
            },
        });
        const entry = { channel, worker, fail: new Emitter<unknown>() };
        live.push(entry);
        const mainPort = channel.port1;
        const connection: ITextMateWorkerConnection = {
            postMessage: (message, transfer) => {
                sent.push(message);
                mainPort.postMessage(message, transfer === undefined ? [] : [...transfer]);
            },
            onMessage: (listener) => {
                const handler = (message: WorkerToMainMessage): void => {
                    listener(message);
                };
                mainPort.on("message", handler);
                return {
                    dispose: () => {
                        mainPort.off("message", handler);
                    },
                };
            },
            onDidFail: (listener) => entry.fail.event(listener),
            terminate: () => {
                close(entry);
            },
        };
        return connection;
    };

    return {
        spawn,
        spawned: () => count,
        sent,
        crash: (error = new Error("worker crashed")) => {
            const entry = live[live.length - 1];
            close(entry);
            entry.fail.fire(error);
        },
        dispose: () => {
            for (const entry of live) close(entry);
        },
    };
}
