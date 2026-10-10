import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import type { Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore } from "../../../../base/common/lifecycle.ts";
import { createRange } from "../../../common/core/iRange.ts";
import type { LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type { DocumentRangeSemanticTokensProvider } from "../../../common/languages/iSemanticTokensSource.ts";
import type { FeatureDebounce } from "../../../common/services/languageFeatureDebounce.ts";
import { decodeSemanticTokens } from "../../../common/tokens/semanticTokensLines.ts";
import type { SemanticTokensStore } from "../../../common/tokens/semanticTokensStore.ts";
import { getDocumentRangeSemanticTokens } from "../common/getSemanticTokens.ts";

import type { ISemanticTokensModel } from "./documentSemanticTokens.ts";

/** Видимая область вью в строках документа (0-based, включительно). */
export interface IVisibleLineRange {
    readonly startLine: number;
    readonly endLine: number;
}

/** Вью редактора глазами range-провайдера: что видно и когда это меняется. */
export interface ISemanticTokensViewport {
    getVisibleLineRange(): IVisibleLineRange | null;
    readonly onDidChangeVisibleRange: Event<void>;
}

/**
 * Токены видимой области от range-провайдера — перенос
 * `ViewportSemanticTokensContribution` эталона (по экземпляру на вью):
 * работает, только пока у документа нет полного набора токенов; запрос — на
 * видимые строки ± высота вьюпорта (не меньше 20 строк) после адаптивной паузы
 * 100–500 мс; любой триггер отменяет запросы в полёте, а ответ по устаревшей
 * версии документа отбрасывается.
 */
export class ViewportSemanticTokens extends Disposable {
    private readonly scheduler: RunOnceScheduler;
    private outstandingRequests: CancellationTokenSource[] = [];
    private readonly providerListeners = this.register(new DisposableStore());

    public constructor(
        private readonly model: ISemanticTokensModel,
        private readonly tokens: SemanticTokensStore,
        private readonly registry: LanguageFeatureRegistry<DocumentRangeSemanticTokensProvider>,
        private readonly debounce: FeatureDebounce,
        private readonly isEnabled: () => boolean,
        private readonly viewport: ISemanticTokensViewport,
        onDidChangeEnablement: Event<void>,
    ) {
        super();
        this.scheduler = this.register(
            new RunOnceScheduler(() => {
                this.tokenizeViewportNow();
            }, 100),
        );
        const scheduleTokenizeViewport = (): void => {
            this.cancelAll();
            this.scheduler.schedule(this.debounce.get(this.model.uri.toString()));
        };
        const bindRangeProvidersChangeListeners = (): void => {
            this.providerListeners.clear();
            for (const provider of this.registry.ordered(this.model)) {
                if (provider.onDidChange !== undefined) {
                    this.providerListeners.add(provider.onDidChange(scheduleTokenizeViewport));
                }
            }
        };
        this.register(viewport.onDidChangeVisibleRange(scheduleTokenizeViewport));
        this.register(model.document.onDidChangeModelContent(scheduleTokenizeViewport));
        this.register(
            model.onDidChangeLanguage(() => {
                bindRangeProvidersChangeListeners();
                scheduleTokenizeViewport();
            }),
        );
        this.register(
            registry.onDidChange(() => {
                bindRangeProvidersChangeListeners();
                scheduleTokenizeViewport();
            }),
        );
        this.register(onDidChangeEnablement(scheduleTokenizeViewport));
        this.register({
            dispose: () => {
                this.cancelAll();
            },
        });
        bindRangeProvidersChangeListeners();
        scheduleTokenizeViewport();
    }

    private cancelAll(): void {
        for (const request of this.outstandingRequests) request.cancel();
        this.outstandingRequests = [];
    }

    private tokenizeViewportNow(): void {
        if (this.tokens.hasCompleteSemanticTokens()) {
            return;
        }
        if (!this.isEnabled() || !this.registry.has(this.model)) {
            if (this.tokens.hasSomeSemanticTokens()) this.tokens.set(null, false);
            return;
        }
        const visible = this.viewport.getVisibleLineRange();
        if (visible === null) return;
        const margin = Math.max(20, visible.endLine - visible.startLine + 1);
        const lastLine = this.model.document.lineCount - 1;
        const startLine = Math.max(0, visible.startLine - margin);
        const endLine = Math.min(lastLine, visible.endLine + margin);
        this.requestRange(startLine, endLine);
    }

    private requestRange(startLine: number, endLine: number): void {
        const requestVersionId = this.model.document.versionId;
        const cancellation = new CancellationTokenSource();
        this.outstandingRequests.push(cancellation);
        const started = Date.now();
        void getDocumentRangeSemanticTokens(
            this.registry,
            this.model,
            {
                uri: this.model.uri.toString(),
                languageId: this.model.languageId,
                versionId: requestVersionId,
                range: createRange(startLine, 0, endLine, this.model.document.getLineLength(endLine)),
            },
            cancellation.token,
        ).then((result) => {
            this.debounce.update(this.model.uri.toString(), Date.now() - started);
            this.outstandingRequests = this.outstandingRequests.filter((request) => request !== cancellation);
            if (cancellation.token.isCancellationRequested) return;
            if (result?.tokens == null || this.model.document.versionId !== requestVersionId) return;
            this.tokens.setPartial(
                startLine,
                endLine,
                decodeSemanticTokens(result.tokens.data, result.provider.getLegend()),
            );
        });
    }
}
