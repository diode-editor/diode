import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import { readPackagedAssetView } from "../../../../base/node/assets/packagedAsset.ts";
import { LAZY_CHUNK_WRAPPER, lazyChunkAssetName } from "../../../../base/node/lazyModule.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type {
    MainToWorkerMessage,
    WorkerToMainMessage,
} from "../common/backgroundTokenization/textMateWorkerProtocol.ts";
import type {
    ITextMateWorkerConnection,
    TextMateWorkerSpawner,
} from "../common/backgroundTokenization/threadedBackgroundTokenizerFactory.ts";

/** Кусок с кодом воркера — запись `LAZY_CHUNKS` в `scripts/build-lazy-chunks.mjs`. */
export const TEXTMATE_WORKER_CHUNK = "roles/textmate-worker";

/**
 * Код воркера из упакованного куска: исполнить обёртку CJS (как
 * `loadLazyModule`) и запустить вход. Кэш кода куска не передаём: его снимает
 * процесс из V8-снапшота ядра, а изолят воркера стартует без него — V8 кэш
 * отверг бы.
 */
const CHUNK_BOOTSTRAP = `
const { workerData } = require("node:worker_threads");
const vm = require("node:vm");
const filename = workerData.filename;
const wrapper = new vm.Script(workerData.source, { filename }).runInThisContext();
const module = { exports: {} };
wrapper.call(module.exports, module.exports, require, module, filename, ".");
module.exports.runTextMateTokenizationWorker();
`;

export interface ITextMateWorkerSpawnOptions {
    /** Флаги node воркера; по умолчанию — флаги процесса (в dev там загрузчик tsx). */
    readonly execArgv?: readonly string[];
}

/**
 * Запуск воркера фоновой токенизации в `worker_threads`. Откуда код:
 *  - упакованная сборка (SEA, `node dist/main.cjs`) — ленивый кусок
 *    {@link TEXTMATE_WORKER_CHUNK}: главный поток читает его байты и отдаёт
 *    воркеру исходником (в SEA у куска нет файла на диске);
 *  - dev (tsx) — модуль-вход из исходников `import()`'ом: загрузчик tsx
 *    воркер наследует с флагами процесса.
 *
 * Вывод воркера (`stdout`/`stderr`) не идёт в терминал — там кадр TUI, — а
 * уходит в лог. Воркер не держит процесс (`unref`).
 */
export function createTextMateWorkerSpawner(
    logger?: ILogger,
    options: ITextMateWorkerSpawnOptions = {},
): TextMateWorkerSpawner {
    return () => {
        const chunk = readPackagedAssetView(lazyChunkAssetName(TEXTMATE_WORKER_CHUNK));
        const common = {
            stdout: true,
            stderr: true,
            execArgv: options.execArgv === undefined ? undefined : [...options.execArgv],
        };
        const worker =
            chunk === null
                ? new Worker(devBootstrap(), { ...common, eval: true })
                : new Worker(CHUNK_BOOTSTRAP, {
                      ...common,
                      eval: true,
                      workerData: {
                          filename: `diode:${lazyChunkAssetName(TEXTMATE_WORKER_CHUNK)}`,
                          source:
                              LAZY_CHUNK_WRAPPER.prefix + new TextDecoder().decode(chunk) + LAZY_CHUNK_WRAPPER.suffix,
                      },
                  });
        worker.unref();
        const forward = (level: "info" | "error") => (data: Buffer) => {
            const text = data.toString().trimEnd();
            if (text.length > 0) logger?.[level](`TextMate worker: ${text}`);
        };
        worker.stdout.on("data", forward("info"));
        worker.stderr.on("data", forward("error"));
        return toConnection(worker);
    };
}

/**
 * Dev: загрузчик tsx, поставленный процессу флагом `--import tsx`, в воркер не
 * переходит (хуки модулей — свои у каждого потока), и node разобрал бы наш TS
 * сам, без поддержки parameter properties. Ставим tsx в воркере его API.
 */
function devBootstrap(): string {
    const entry = new URL("./textMateTokenizationWorker.workerMain.ts", import.meta.url).href;
    const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm/api")).href;
    return (
        `import(${JSON.stringify(tsx)}).then((tsx) => { tsx.register(); return import(${JSON.stringify(entry)}); })` +
        ".then((m) => m.runTextMateTokenizationWorker());"
    );
}

function toConnection(worker: Worker): ITextMateWorkerConnection {
    let terminated = false;
    return {
        postMessage: (message: MainToWorkerMessage, transfer) => {
            worker.postMessage(message, transfer === undefined ? undefined : [...transfer]);
        },
        onMessage: (listener: (message: WorkerToMainMessage) => void) => {
            worker.on("message", listener);
            return {
                dispose: () => {
                    worker.off("message", listener);
                },
            };
        },
        onDidFail: (listener) => {
            const onError = (error: Error): void => {
                listener(error);
            };
            const onExit = (code: number): void => {
                if (!terminated) listener(new Error(`TextMate worker exited with code ${String(code)}`));
            };
            worker.on("error", onError);
            worker.on("exit", onExit);
            return {
                dispose: () => {
                    worker.off("error", onError);
                    worker.off("exit", onExit);
                },
            };
        },
        terminate: () => {
            terminated = true;
            void worker.terminate();
        },
    };
}
