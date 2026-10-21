import type { IAssetAccess, IAssetEntry } from "../../../../../../base/common/assets/iAssetAccess.ts";
import { onUnexpectedError } from "../../../../../../base/common/errors.ts";
import type { IDisposable } from "../../../../../../base/common/lifecycle.ts";
import type { ITokenizationSupport } from "../../../../../../editor/common/languages.ts";
import type { ITextMateTheme } from "../../../../themes/common/textMateTheme.ts";
import { TextMateGrammarLoader } from "../../textMateGrammarLoader.ts";
import type { IMessagePort, MainToWorkerMessage, WorkerToMainMessage } from "../textMateWorkerProtocol.ts";

import { TextMateWorkerTokenizer } from "./textMateWorkerTokenizer.ts";

/**
 * Воркер фоновой токенизации — upstream `TextMateTokenizationWorker`
 * (`worker/textMateTokenizationWorker.worker.ts`): держит грамматики (свой
 * `TextMateGrammarLoader` поверх своего oniguruma) и модели документов по
 * `controllerId`. Файлы грамматик и `onig.wasm` читает через главный поток
 * (upstream `$readFile`). Окружение — любое: сюда приходит порт, а
 * `worker_threads` — в `node/textMateTokenizationWorker.workerMain.ts`.
 */
export class TextMateTokenizationWorker implements IDisposable {
    private readonly models = new Map<number, TextMateWorkerTokenizer>();
    private readonly pendingReads = new Map<number, PromiseWithResolvers<string | Uint8Array>>();
    private nextRequestId = 0;
    private loader: TextMateGrammarLoader | undefined;
    private readonly supports = new Map<string, Promise<ITokenizationSupport | null>>();
    private readonly subscription: IDisposable;

    public constructor(private readonly port: IMessagePort<MainToWorkerMessage, WorkerToMainMessage>) {
        this.subscription = port.onMessage((message) => {
            this.handle(message);
        });
    }

    public dispose(): void {
        this.subscription.dispose();
        for (const model of this.models.values()) model.dispose();
        this.models.clear();
        this.loader?.dispose();
    }

    private handle(message: MainToWorkerMessage): void {
        switch (message.type) {
            case "init":
                this.loader = new TextMateGrammarLoader(this.createAssetAccess(), message.grammars);
                if (message.theme !== undefined) this.loader.setTheme(message.theme);
                return;
            case "acceptTheme":
                this.acceptTheme(message.theme);
                return;
            case "preloadGrammar":
                void this.getOrCreateSupport(message.scopeName);
                return;
            case "acceptNewModel": {
                this.models.get(message.controllerId)?.dispose();
                const { controllerId } = message;
                this.models.set(
                    controllerId,
                    new TextMateWorkerTokenizer(
                        message.text,
                        message.versionId,
                        {
                            getOrCreateSupport: (scopeName) => this.getOrCreateSupport(scopeName),
                            setTokensAndStates: (versionId, tokens, stateDeltas) => {
                                this.port.postMessage(
                                    { type: "setTokensAndStates", controllerId, versionId, tokens, stateDeltas },
                                    [tokens.buffer as ArrayBuffer],
                                );
                            },
                        },
                        message.scopeName,
                    ),
                );
                return;
            }
            case "acceptModelChanged":
                this.models.get(message.controllerId)?.onEvents(message.versionId, message.changes);
                return;
            case "retokenize":
                this.models
                    .get(message.controllerId)
                    ?.retokenize(message.startLineNumber, message.endLineNumberExclusive);
                return;
            case "acceptRemovedModel":
                this.models.get(message.controllerId)?.dispose();
                this.models.delete(message.controllerId);
                return;
            case "readFileResult": {
                const pending = this.pendingReads.get(message.requestId);
                if (pending === undefined) return;
                this.pendingReads.delete(message.requestId);
                const result = message.text ?? message.bytes;
                if (result === undefined) pending.reject(new Error(message.error));
                else pending.resolve(result);
                return;
            }
        }
    }

    /**
     * Upstream `$acceptTheme`: уже загруженные грамматики подхватывают тему сами,
     * а модели перетокенизирует главный поток — пересозданием контроллеров
     * (`TokenizationRegistry.setColorMap` → новый фон с нуля).
     */
    private acceptTheme(theme: ITextMateTheme): void {
        this.loader?.setTheme(theme);
    }

    private getOrCreateSupport(scopeName: string): Promise<ITokenizationSupport | null> {
        const loader = this.loader;
        if (loader === undefined) return Promise.resolve(null);
        let pending = this.supports.get(scopeName);
        if (pending === undefined) {
            pending = loader.loadSupport(scopeName).catch((error: unknown) => {
                // Без грамматики модель просто не токенизируется в фоне — главный
                // поток красит вьюпорт сам; сбой — в лог, а не крах воркера.
                onUnexpectedError(error);
                return null;
            });
            this.supports.set(scopeName, pending);
        }
        return pending;
    }

    /** Ассеты главного потока по каналу (upstream `TextMateWorkerHost.$readFile`). */
    private createAssetAccess(): IAssetAccess {
        const read = (path: string, binary: boolean): Promise<string | Uint8Array> => {
            const requestId = this.nextRequestId++;
            const pending = Promise.withResolvers<string | Uint8Array>();
            this.pendingReads.set(requestId, pending);
            this.port.postMessage({ type: "readFile", requestId, path, binary });
            return pending.promise;
        };
        return {
            read: (path) => read(path, true) as Promise<Uint8Array>,
            readText: (path) => read(path, false) as Promise<string>,
            exists: () => Promise.reject(new Error("TextMate worker: exists() is not available")),
            listEntries: (): Promise<IAssetEntry[]> =>
                Promise.reject(new Error("TextMate worker: listEntries() is not available")),
        };
    }
}
