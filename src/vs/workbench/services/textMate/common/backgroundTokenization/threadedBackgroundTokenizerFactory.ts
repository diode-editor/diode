import type { IAssetAccess } from "../../../../../base/common/assets/iAssetAccess.ts";
import type { Event } from "../../../../../base/common/event.ts";
import { Emitter } from "../../../../../base/common/event.ts";
import type { IDisposable } from "../../../../../base/common/lifecycle.ts";
import { mark } from "../../../../../base/common/performance.ts";
import type { IBackgroundTokenizationStore, IBackgroundTokenizer } from "../../../../../editor/common/languages.ts";
import type { ITextDocument } from "../../../../../editor/common/model/iTextDocument.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type { ITextMateTheme } from "../../../themes/common/textMateTheme.ts";
import type { IGrammarRecord } from "../textMateGrammarLoader.ts";

import type { IMessagePort, MainToWorkerMessage, WorkerToMainMessage } from "./textMateWorkerProtocol.ts";
import { TextMateWorkerTokenizerController } from "./textMateWorkerTokenizerController.ts";

/** Связь с запущенным воркером (`worker_threads` — `node/textMateWorkerSpawner.ts`). */
export interface ITextMateWorkerConnection extends IMessagePort<WorkerToMainMessage, MainToWorkerMessage> {
    /** Воркер упал или завершился сам: сообщения больше не доходят. */
    onDidFail(listener: (error: unknown) => void): IDisposable;
    terminate(): void;
}

/** Запуск воркера; бросает, если воркер в этом окружении не поднять. */
export type TextMateWorkerSpawner = () => ITextMateWorkerConnection;

/**
 * Фоновая токенизация в воркере — upstream `ThreadedBackgroundTokenizerFactory`:
 * один воркер на процесс, по контроллеру на документ. Воркер поднимается при
 * первой нужде и получает грамматики и тему; файлы грамматик и `onig.wasm`
 * читает для него этот поток (upstream `$readFile`).
 *
 * Отличия от эталона:
 * - воркер можно поднять заранее ({@link preloadGrammar}): старт грузит
 *   грамматики открываемых файлов, и воркер к открытию документа уже готов;
 * - воркер упал (или не поднялся) — фабрика больше его не поднимает,
 *   {@link createBackgroundTokenizer} отдаёт `undefined`, и токенизация
 *   откатывается на главный поток: {@link onDidFail} пересоздаёт фон
 *   документов (эталон в браузере на падение воркера не рассчитывает).
 */
export class ThreadedBackgroundTokenizerFactory implements IDisposable {
    private worker: ITextMateWorkerConnection | undefined;
    private workerSubscriptions: IDisposable[] = [];
    private failed = false;
    private readonly controllers = new Map<number, TextMateWorkerTokenizerController>();
    private nextControllerId = 0;
    private grammarDefinitions: readonly IGrammarRecord[] = [];
    private currentTheme: ITextMateTheme | undefined;

    private readonly onDidFailEmitter = new Emitter<void>();
    /** Воркер упал: фон документов пора пересоздать — уже в главном потоке. */
    public readonly onDidFail: Event<void> = this.onDidFailEmitter.event;

    public constructor(
        private readonly spawn: TextMateWorkerSpawner,
        private readonly assets: IAssetAccess,
        /** Upstream `editor.experimental.asyncTokenization`. */
        private readonly shouldTokenizeAsync: () => boolean,
        private readonly logger?: ILogger,
    ) {}

    public dispose(): void {
        this.disposeWorker();
        this.onDidFailEmitter.dispose();
    }

    /**
     * Upstream — фоновый токенизатор модели или `undefined`, тогда фон идёт в
     * главном потоке (`DefaultBackgroundTokenizer`).
     */
    public createBackgroundTokenizer(
        document: ITextDocument,
        store: IBackgroundTokenizationStore,
        scopeName: string,
    ): IBackgroundTokenizer | undefined {
        if (!this.shouldTokenizeAsync()) return undefined;
        const worker = this.getWorker();
        if (worker === undefined) return undefined;

        const controllerId = this.nextControllerId++;
        const controller = new TextMateWorkerTokenizerController(
            controllerId,
            document,
            scopeName,
            (message) => {
                worker.postMessage(message);
            },
            store,
        );
        this.controllers.set(controllerId, controller);
        return {
            dispose: () => {
                // Воркер мог смениться (упал) — тогда контроллер уже снят.
                if (this.controllers.get(controllerId) !== controller) return;
                this.controllers.delete(controllerId);
                controller.dispose();
            },
            requestTokens: (startLineNumber, endLineNumberExclusive) => {
                if (this.controllers.get(controllerId) === controller) {
                    controller.requestTokens(startLineNumber, endLineNumberExclusive);
                }
            },
        };
    }

    /** Поднять воркер и загрузить в нём грамматику заранее (наше, см. шапку). */
    public preloadGrammar(scopeName: string): void {
        if (!this.shouldTokenizeAsync()) return;
        this.getWorker()?.postMessage({ type: "preloadGrammar", scopeName });
    }

    public setGrammarDefinitions(grammarDefinitions: readonly IGrammarRecord[]): void {
        this.grammarDefinitions = grammarDefinitions;
        this.disposeWorker();
    }

    public acceptTheme(theme: ITextMateTheme): void {
        this.currentTheme = theme;
        this.worker?.postMessage({ type: "acceptTheme", theme });
    }

    private getWorker(): ITextMateWorkerConnection | undefined {
        if (this.failed) return undefined;
        if (this.worker !== undefined) return this.worker;
        let worker: ITextMateWorkerConnection;
        try {
            worker = this.spawn();
        } catch (error) {
            this.fail(error);
            return undefined;
        }
        mark("textmate:worker-spawned");
        this.worker = worker;
        this.workerSubscriptions = [
            worker.onMessage((message) => {
                this.handle(worker, message);
            }),
            worker.onDidFail((error) => {
                if (this.worker === worker) this.fail(error);
            }),
        ];
        worker.postMessage({ type: "init", grammars: this.grammarDefinitions, theme: this.currentTheme });
        return worker;
    }

    private handle(worker: ITextMateWorkerConnection, message: WorkerToMainMessage): void {
        switch (message.type) {
            case "readFile":
                mark("textmate:worker-read", { path: message.path });
                void this.readFile(worker, message.requestId, message.path, message.binary);
                return;
            case "setTokensAndStates":
                mark("textmate:worker-tokens", { controllerId: message.controllerId });
                // When a model detaches, it is removed synchronously from the map.
                // However, the worker might still be sending tokens for that model,
                // so we ignore the event when there is no controller.
                this.controllers
                    .get(message.controllerId)
                    ?.setTokensAndStates(message.versionId, message.tokens, message.stateDeltas);
                return;
            case "unexpectedError":
                this.logger?.error(`TextMate worker: ${message.message}`);
                return;
        }
    }

    private async readFile(
        worker: ITextMateWorkerConnection,
        requestId: number,
        path: string,
        binary: boolean,
    ): Promise<void> {
        try {
            if (binary) {
                worker.postMessage({ type: "readFileResult", requestId, bytes: await this.assets.read(path) });
            } else {
                worker.postMessage({ type: "readFileResult", requestId, text: await this.assets.readText(path) });
            }
        } catch (error) {
            worker.postMessage({ type: "readFileResult", requestId, error: String(error) });
        }
    }

    private fail(error: unknown): void {
        this.logger?.error("TextMate worker failed, tokenizing on the main thread", error);
        this.failed = true;
        this.disposeWorker();
        this.onDidFailEmitter.fire();
    }

    private disposeWorker(): void {
        for (const controller of this.controllers.values()) controller.dispose();
        this.controllers.clear();
        for (const subscription of this.workerSubscriptions) subscription.dispose();
        this.workerSubscriptions = [];
        this.worker?.terminate();
        this.worker = undefined;
    }
}
