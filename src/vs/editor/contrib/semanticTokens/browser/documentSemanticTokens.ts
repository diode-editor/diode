import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { isCancellationError } from "../../../../base/common/errorSerialization.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import {
    type DocumentSemanticTokensProvider,
    type ISemanticTokens,
    type ISemanticTokensEdits,
    isSemanticTokensEdits,
} from "../../../common/languages/iSemanticTokensSource.ts";
import {
    type ISemanticTokenStyleResolver,
    SemanticTokenStyleResolverDIToken,
} from "../../../common/languages/iSemanticTokenStyleResolver.ts";
import type { IModelContentChangedEvent } from "../../../common/model/iDocumentContentChange.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";
import { FeatureDebounce } from "../../../common/services/languageFeatureDebounce.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../../common/services/languageFeatures.ts";
import { decodeSemanticTokens } from "../../../common/tokens/semanticTokensLines.ts";
import { SemanticTokensStore } from "../../../common/tokens/semanticTokensStore.ts";
import { getDocumentSemanticTokens } from "../common/getSemanticTokens.ts";
import { isSemanticColoringEnabled, SEMANTIC_HIGHLIGHTING_SETTING_ID } from "../common/semanticTokensConfig.ts";

import { type ISemanticTokensViewport, ViewportSemanticTokens } from "./viewportSemanticTokens.ts";

/** Модель глазами семантической подсветки: документ, язык и ресурс. */
export interface ISemanticTokensModel extends ILanguageFeatureTarget {
    readonly document: ITextDocument;
    readonly onDidChangeLanguage: Event<unknown>;
}

/** Ссылка вью на семантические токены своего документа; dispose — вью закрыта. */
export interface ISemanticTokensReference extends IDisposable {
    readonly store: SemanticTokensStore;
    /** Токены видимой области этой вью от range-провайдера (пока нет полного набора). */
    attachViewport(viewport: ISemanticTokensViewport): IDisposable;
}

interface IEntry {
    readonly model: ISemanticTokensModel;
    readonly store: SemanticTokensStore;
    coloring: ModelSemanticColoring | null;
    refs: number;
}

/**
 * Семантическая подсветка документов, открытых в редакторах, — перенос
 * `DocumentSemanticTokensFeature` эталона. На документ — одно хранилище
 * токенов (общее для всех его вью) и, пока подсветка включена
 * (`editor.semanticHighlighting.enabled` / флаг темы), один
 * {@link ModelSemanticColoring}, который ходит к провайдеру документа.
 *
 * Документ «прикреплён к редактору», пока на него есть ссылка
 * ({@link attach}); последняя снятая ссылка забывает его целиком.
 */
export class DocumentSemanticTokensFeature extends Disposable {
    public static dependencies = [
        LanguageFeaturesServiceDIToken,
        IConfigurationServiceDIToken,
        SemanticTokenStyleResolverDIToken,
    ] as const;

    private readonly entries = new Map<ITextDocument, IEntry>();
    private readonly debounce = new FeatureDebounce(
        ModelSemanticColoring.REQUEST_MIN_DELAY,
        ModelSemanticColoring.REQUEST_MAX_DELAY,
    );
    private readonly viewportDebounce = new FeatureDebounce(100, 500);
    private readonly onDidChangeEnablementEmitter = this.register(new Emitter<void>());

    public constructor(
        private readonly languageFeatures: ILanguageFeaturesService,
        private readonly configuration: IConfigurationService,
        private readonly theme: ISemanticTokenStyleResolver,
    ) {
        super();
        this.register(
            configuration.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(SEMANTIC_HIGHLIGHTING_SETTING_ID)) this.handleSettingOrThemeChange();
            }),
        );
        this.register(
            theme.onDidChange(() => {
                this.handleSettingOrThemeChange();
            }),
        );
        this.register({
            dispose: () => {
                for (const entry of this.entries.values()) {
                    entry.coloring?.dispose();
                    entry.store.dispose();
                }
                this.entries.clear();
            },
        });
    }

    /** Тема семантических токенов — её же редактор зовёт при отрисовке. */
    public get styleResolver(): ISemanticTokenStyleResolver {
        return this.theme;
    }

    /** Вью документа открыта: его токены и (если включено) их запрос у провайдера. */
    public attach(model: ISemanticTokensModel): ISemanticTokensReference {
        let entry = this.entries.get(model.document);
        if (entry === undefined) {
            const store = new SemanticTokensStore(model.document);
            entry = { model, store, coloring: null, refs: 0 };
            this.entries.set(model.document, entry);
            this.update(entry);
        }
        entry.refs++;
        const attached = entry;
        let disposed = false;
        return {
            store: attached.store,
            attachViewport: (viewport) =>
                new ViewportSemanticTokens(
                    attached.model,
                    attached.store,
                    this.languageFeatures.documentRangeSemanticTokensProvider,
                    this.viewportDebounce,
                    () => isSemanticColoringEnabled(attached.model.languageId, this.configuration, this.theme),
                    viewport,
                    this.onDidChangeEnablementEmitter.event,
                ),
            dispose: () => {
                if (disposed) return;
                disposed = true;
                if (--attached.refs > 0) return;
                attached.coloring?.dispose();
                attached.store.dispose();
                this.entries.delete(attached.model.document);
            },
        };
    }

    private handleSettingOrThemeChange(): void {
        for (const entry of this.entries.values()) this.update(entry);
        this.onDidChangeEnablementEmitter.fire();
    }

    private update(entry: IEntry): void {
        const enabled = isSemanticColoringEnabled(entry.model.languageId, this.configuration, this.theme);
        if (enabled && entry.coloring === null) {
            entry.coloring = new ModelSemanticColoring(
                entry.model,
                entry.store,
                this.languageFeatures.documentSemanticTokensProvider,
                this.debounce,
            );
        } else if (!enabled && entry.coloring !== null) {
            entry.coloring.dispose();
            entry.coloring = null;
        }
    }
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const DocumentSemanticTokensFeatureDIToken = token<DocumentSemanticTokensFeature>(
    "DocumentSemanticTokensFeature",
);

/** Ответ провайдера, от которого считается следующая дельта; dispose — release у провайдера. */
class SemanticTokensResponse {
    public constructor(
        public readonly provider: DocumentSemanticTokensProvider,
        public readonly resultId: string | undefined,
        public readonly data: Uint32Array,
    ) {}

    public dispose(): void {
        this.provider.releaseDocumentSemanticTokens(this.resultId);
    }
}

/**
 * Запросы токенов одного документа — перенос `ModelSemanticColoring` эталона:
 *
 * - первый запрос сразу, дальше — не чаще адаптивной паузы (300–2000 мс)
 *   после правки (правка не отодвигает уже запланированный запрос);
 * - запрос в полёте не отменяется правкой: его ответ сдвигается правками,
 *   сделанными за время запроса, и запрос планируется снова;
 * - смена языка — отмена, release и немедленный перезапрос;
 * - `onDidChange` провайдера — немедленный перезапрос (или после текущего);
 * - дельта (`SemanticTokensEdits`) накладывается на данные прошлого ответа.
 *
 * Отступление (согласовано): смена темы токены не стирает и сервер не
 * перезапрашивает — стиль берётся при отрисовке.
 */
export class ModelSemanticColoring extends Disposable {
    public static readonly REQUEST_MIN_DELAY = 300;
    public static readonly REQUEST_MAX_DELAY = 2000;

    private isDisposed = false;
    private readonly fetchScheduler: RunOnceScheduler;
    private currentResponse: SemanticTokensResponse | null = null;
    private currentRequest: CancellationTokenSource | null = null;
    private relevantProviders = new Set<DocumentSemanticTokensProvider>();
    private readonly providerListeners = this.register(new DisposableStore());
    private providersChangedDuringRequest = false;

    public constructor(
        private readonly model: ISemanticTokensModel,
        private readonly tokens: SemanticTokensStore,
        private readonly registry: LanguageFeatureRegistry<DocumentSemanticTokensProvider>,
        private readonly debounce: FeatureDebounce,
    ) {
        super();
        this.fetchScheduler = this.register(
            new RunOnceScheduler(() => {
                this.fetchNow();
            }, ModelSemanticColoring.REQUEST_MIN_DELAY),
        );
        this.updateRelevantProviders();

        this.register(
            model.document.onDidChangeModelContent(() => {
                if (!this.fetchScheduler.isScheduled()) this.fetchScheduler.schedule(this.delay());
            }),
        );
        this.register(
            model.onDidChangeLanguage(() => {
                // clear any outstanding state
                this.currentResponse?.dispose();
                this.currentResponse = null;
                this.currentRequest?.cancel();
                this.currentRequest = null;
                this.setDocumentSemanticTokens(null, null, []);
                this.updateRelevantProviders();
                this.fetchScheduler.schedule(0);
            }),
        );
        this.register(
            registry.onDidChange(() => {
                this.updateRelevantProviders();
                this.fetchScheduler.schedule(this.delay());
            }),
        );
        this.fetchScheduler.schedule(0);
    }

    public override dispose(): void {
        this.currentResponse?.dispose();
        this.currentResponse = null;
        this.currentRequest?.cancel();
        this.currentRequest = null;
        this.setDocumentSemanticTokens(null, null, []);
        this.isDisposed = true;
        super.dispose();
    }

    private delay(): number {
        return this.debounce.get(this.model.uri.toString());
    }

    private handleProviderDidChange(): void {
        if (this.currentRequest !== null) {
            // there is already a request running
            this.providersChangedDuringRequest = true;
            return;
        }
        this.fetchScheduler.schedule(0);
    }

    private updateRelevantProviders(): void {
        this.relevantProviders = new Set(this.registry.ordered(this.model));
        this.providerListeners.clear();
        for (const provider of this.relevantProviders) {
            const onDidChange = provider.onDidChange;
            if (onDidChange !== undefined) {
                this.providerListeners.add(
                    onDidChange(() => {
                        this.handleProviderDidChange();
                    }),
                );
            }
        }
    }

    private fetchNow(): void {
        if (this.currentRequest !== null) {
            // there is already a request running, let it finish...
            return;
        }
        if (!this.registry.has(this.model)) {
            // there is no provider
            if (this.currentResponse !== null) this.tokens.set(null, false);
            return;
        }

        const cancellation = new CancellationTokenSource();
        const lastProvider = this.currentResponse?.provider ?? null;
        const lastResultId = this.currentResponse?.resultId ?? null;
        this.currentRequest = cancellation;
        this.providersChangedDuringRequest = false;

        const pendingChanges: IModelContentChangedEvent[] = [];
        const contentChangeListener = this.model.document.onDidChangeModelContent((e) => {
            pendingChanges.push(e);
        });

        const started = Date.now();
        const request = getDocumentSemanticTokens(
            this.registry,
            this.model,
            {
                uri: this.model.uri.toString(),
                languageId: this.model.languageId,
                versionId: this.model.document.versionId,
            },
            lastProvider,
            lastResultId === "" ? null : lastResultId,
            cancellation.token,
        );
        request.then(
            (res) => {
                this.debounce.update(this.model.uri.toString(), Date.now() - started);
                this.currentRequest = null;
                contentChangeListener.dispose();
                if (res === null) {
                    this.setDocumentSemanticTokens(null, null, pendingChanges);
                } else {
                    this.setDocumentSemanticTokens(res.provider, res.tokens, pendingChanges);
                }
            },
            (err: unknown) => {
                const message = (err as { message?: unknown } | null)?.message;
                const isExpectedError =
                    isCancellationError(err) || (typeof message === "string" && message.includes("busy"));
                if (!isExpectedError) onUnexpectedError(err);
                // Semantic tokens eats up all errors and considers errors to mean
                // that the result is temporarily not available.
                this.currentRequest = null;
                contentChangeListener.dispose();
                if (
                    (pendingChanges.length > 0 || this.providersChangedDuringRequest) &&
                    !this.fetchScheduler.isScheduled()
                ) {
                    this.fetchScheduler.schedule(this.delay());
                }
            },
        );
    }

    private setDocumentSemanticTokens(
        provider: DocumentSemanticTokensProvider | null,
        received: ISemanticTokens | ISemanticTokensEdits | null,
        pendingChanges: readonly IModelContentChangedEvent[],
    ): void {
        const currentResponse = this.currentResponse;
        const rescheduleIfNeeded = (): void => {
            if (
                (pendingChanges.length > 0 || this.providersChangedDuringRequest) &&
                !this.fetchScheduler.isScheduled()
            ) {
                this.fetchScheduler.schedule(this.delay());
            }
        };

        this.currentResponse?.dispose();
        this.currentResponse = null;
        if (this.isDisposed) {
            // disposed!
            if (provider !== null && received !== null) provider.releaseDocumentSemanticTokens(received.resultId);
            return;
        }
        if (provider === null) {
            this.tokens.set(null, false);
            return;
        }
        if (received === null) {
            this.tokens.set(null, true);
            rescheduleIfNeeded();
            return;
        }

        let tokens: ISemanticTokens;
        if (isSemanticTokensEdits(received)) {
            if (currentResponse === null) {
                // not possible!
                this.tokens.set(null, true);
                return;
            }
            const data = applySemanticTokensEdits(currentResponse.data, received);
            if (data === null) {
                // The edits are invalid and there's no way to recover
                this.tokens.set(null, true);
                return;
            }
            tokens = { resultId: received.resultId, data };
        } else {
            tokens = received;
        }

        this.currentResponse = new SemanticTokensResponse(provider, tokens.resultId, tokens.data);
        const result = decodeSemanticTokens(tokens.data, provider.getLegend());
        // More changes occurred while the request was running: adjust incoming tokens.
        for (const change of pendingChanges) {
            for (const singleChange of change.changes) result.applyEdit(singleChange.range, singleChange.text);
        }
        this.tokens.set(result, true);
        rescheduleIfNeeded();
    }
}

/**
 * Дельта поверх данных прошлого ответа (правки — в индексах старого массива,
 * накладываются с конца). `null` — правка начинается за его концом.
 */
export function applySemanticTokensEdits(srcData: Uint32Array, edits: ISemanticTokensEdits): Uint32Array | null {
    if (edits.edits.length === 0) {
        // nothing to do!
        return srcData;
    }
    let deltaLength = 0;
    for (const edit of edits.edits) {
        deltaLength += (edit.data?.length ?? 0) - edit.deleteCount;
    }
    const destData = new Uint32Array(srcData.length + deltaLength);
    let srcLastStart = srcData.length;
    let destLastStart = destData.length;
    for (let i = edits.edits.length - 1; i >= 0; i--) {
        const edit = edits.edits[i];
        if (edit.start > srcData.length) {
            return null;
        }
        const copyCount = srcLastStart - (edit.start + edit.deleteCount);
        if (copyCount > 0) {
            copy(srcData, srcLastStart - copyCount, destData, destLastStart - copyCount, copyCount);
            destLastStart -= copyCount;
        }
        if (edit.data !== undefined) {
            copy(edit.data, 0, destData, destLastStart - edit.data.length, edit.data.length);
            destLastStart -= edit.data.length;
        }
        srcLastStart = edit.start;
    }
    if (srcLastStart > 0) {
        copy(srcData, 0, destData, 0, srcLastStart);
    }
    return destData;
}

function copy(src: Uint32Array, srcOffset: number, dest: Uint32Array, destOffset: number, length: number): void {
    // protect against overflows
    const count = Math.min(length, dest.length - destOffset, src.length - srcOffset);
    for (let i = 0; i < count; i++) {
        dest[destOffset + i] = src[srcOffset + i];
    }
}
