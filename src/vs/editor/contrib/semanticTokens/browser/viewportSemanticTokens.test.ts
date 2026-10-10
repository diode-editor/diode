import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../common/core/iRange.ts";
import { createInsertEdit } from "../../../common/core/iTextEdit.ts";
import type {
    DocumentRangeSemanticTokensProvider,
    IRangeSemanticTokensRequest,
    ISemanticTokens,
    ISemanticTokensLegend,
} from "../../../common/languages/iSemanticTokensSource.ts";
import {
    type ISemanticTokenStyleResolver,
    NULL_SEMANTIC_TOKEN_STYLE_RESOLVER,
} from "../../../common/languages/iSemanticTokenStyleResolver.ts";
import { TextDocument } from "../../../common/model/textDocument.ts";
import { LanguageFeaturesService } from "../../../common/services/languageFeaturesService.ts";
import { decodeSemanticTokens } from "../../../common/tokens/semanticTokensLines.ts";
import { SEMANTIC_HIGHLIGHTING_SETTING_ID } from "../common/semanticTokensConfig.ts";

import { DocumentSemanticTokensFeature } from "./documentSemanticTokens.ts";
import type { IVisibleLineRange } from "./viewportSemanticTokens.ts";

const LEGEND: ISemanticTokensLegend = { tokenTypes: ["variable"], tokenModifiers: [] };

interface IRangeCall {
    readonly request: IRangeSemanticTokensRequest;
    readonly token: ICancellationToken;
    resolve(value: ISemanticTokens | null): void;
}

class FakeRangeProvider implements DocumentRangeSemanticTokensProvider {
    public readonly calls: IRangeCall[] = [];
    public readonly changeEmitter = new Emitter<void>();
    public readonly onDidChange = this.changeEmitter.event;
    public getLegend(): ISemanticTokensLegend {
        return LEGEND;
    }
    public provideDocumentRangeSemanticTokens(
        request: IRangeSemanticTokensRequest,
        token: ICancellationToken,
    ): Promise<ISemanticTokens | null> {
        return new Promise((resolve) => {
            this.calls.push({ request, token, resolve });
        });
    }
    public last(): IRangeCall {
        const call = this.calls.at(-1);
        if (call === undefined) throw new Error("no calls");
        return call;
    }
}

const THEME: ISemanticTokenStyleResolver = { ...NULL_SEMANTIC_TOKEN_STYLE_RESOLVER, semanticHighlighting: true };

/** Документ из `count` строк вида `line N`. */
function documentOf(count: number): TextDocument {
    return new TextDocument(Array.from({ length: count }, (_, i) => `line ${String(i)}`).join("\n"), "java");
}

function setup(lineCount = 100, visible: IVisibleLineRange | null = { startLine: 40, endLine: 49 }) {
    const features = new LanguageFeaturesService();
    const configuration = createTestConfigurationService();
    const provider = new FakeRangeProvider();
    const registration = features.documentRangeSemanticTokensProvider.register("java", provider);
    const feature = new DocumentSemanticTokensFeature(features, configuration, THEME);
    const document = documentOf(lineCount);
    const ref = feature.attach({
        document,
        uri: Uri.file("/w/A.java"),
        get languageId() {
            return document.languageId;
        },
        onDidChangeLanguage: document.onDidChangeLanguage,
    });
    const scroll = new Emitter<void>();
    const viewport = { range: visible };
    const view = ref.attachViewport({
        getVisibleLineRange: () => viewport.range,
        onDidChangeVisibleRange: scroll.event,
    });
    return { features, configuration, provider, registration, document, ref, scroll, viewport, view };
}

/** Токен длины 2 в начале строки `line`. */
function tokenAt(line: number): ISemanticTokens {
    return { resultId: "0", data: new Uint32Array([line, 0, 2, 0, 0]) };
}

async function tick(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
}

describe("ViewportSemanticTokens", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("после паузы спрашивает видимые строки ± max(20, высота) целиком и кладёт ответ в хранилище", async () => {
        const { provider, ref, document } = setup();
        await tick(149);
        expect(provider.calls).toHaveLength(0);
        await tick(1);
        expect(provider.calls).toHaveLength(1);
        expect(provider.last().request).toEqual({
            uri: Uri.file("/w/A.java").toString(),
            languageId: "java",
            versionId: document.versionId,
            range: createRange(20, 0, 69, "line 69".length),
        });
        provider.last().resolve(tokenAt(45));
        await tick();
        expect(ref.store.getLineTokens(45)?.tokens).toEqual([0, 2, 0, 0]);
        expect(ref.store.hasCompleteSemanticTokens()).toBe(false);
    });

    it("высокий вьюпорт — запас в его высоту; края документа зажимают диапазон", async () => {
        const tall = setup(100, { startLine: 0, endLine: 29 });
        await tick(150);
        expect(tall.provider.last().request.range).toEqual(createRange(0, 0, 59, "line 59".length));

        const short = setup(10, { startLine: 2, endLine: 5 });
        await tick(150);
        expect(short.provider.last().request.range).toEqual(createRange(0, 0, 9, "line 9".length));
    });

    it("ответ кладётся только в свой диапазон строк", async () => {
        const { provider, ref } = setup();
        ref.store.setPartial(0, 99, decodeSemanticTokens(new Uint32Array([10, 0, 1, 0, 0, 30, 0, 1, 0, 0]), LEGEND));
        await tick(150);
        provider.last().resolve({ resultId: "0", data: new Uint32Array([45, 0, 2, 0, 0]) });
        await tick();
        // Строка 10 вне диапазона 20..69 осталась, 40 внутри — заменена пустотой.
        expect(ref.store.getLineTokens(10)?.tokens).toEqual([0, 1, 0, 0]);
        expect(ref.store.getLineTokens(40)).toBeUndefined();
        expect(ref.store.getLineTokens(45)?.tokens).toEqual([0, 2, 0, 0]);
    });

    it("пустой ответ ничего не трогает", async () => {
        const { provider, ref } = setup();
        const listener = vi.fn();
        ref.store.onDidChange(listener);
        await tick(150);
        provider.last().resolve(null);
        await tick();
        expect(listener).not.toHaveBeenCalled();
    });

    it("полный набор есть — range-провайдер не зовётся", async () => {
        const { provider, ref, scroll } = setup();
        ref.store.set(null, true);
        await tick(150);
        scroll.fire();
        await tick(1000);
        expect(provider.calls).toHaveLength(0);
    });

    it("видимой области нет — запроса нет", async () => {
        const { provider } = setup(100, null);
        await tick(1000);
        expect(provider.calls).toHaveLength(0);
    });

    it("скролл отменяет запрос в полёте: его ответ отброшен, новый — после паузы", async () => {
        const { provider, ref, scroll, viewport } = setup();
        await tick(150);
        const first = provider.last();
        viewport.range = { startLine: 60, endLine: 69 };
        scroll.fire();
        expect(first.token.isCancellationRequested).toBe(true);
        first.resolve(tokenAt(45));
        await tick();
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
        await tick(150);
        expect(provider.calls).toHaveLength(2);
        expect(provider.last().request.range).toEqual(createRange(40, 0, 89, "line 89".length));
    });

    it("правка документа отменяет запрос и перепланирует", async () => {
        const { provider, ref, document } = setup();
        await tick(150);
        const first = provider.last();
        document.applyEdits([createInsertEdit(0, 0, "x")]);
        expect(first.token.isCancellationRequested).toBe(true);
        first.resolve(tokenAt(45));
        await tick(150);
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
        expect(provider.calls).toHaveLength(2);
        expect(provider.last().request.versionId).toBe(document.versionId);
    });

    it("onDidChange провайдера и смена языка перепланируют запрос", async () => {
        const { provider, document } = setup();
        await tick(150);
        provider.last().resolve(null);
        await tick();
        provider.changeEmitter.fire();
        await tick(150);
        expect(provider.calls).toHaveLength(2);
        provider.last().resolve(null);
        await tick();
        document.setLanguage("kotlin");
        // Под kotlin провайдера нет — запроса нет, а подписка на старого снята.
        await tick(150);
        provider.changeEmitter.fire();
        await tick(150);
        expect(provider.calls).toHaveLength(2);
    });

    it("подсветка выключена — частичные токены стираются, запроса нет", async () => {
        const { provider, ref, configuration } = setup();
        await tick(150);
        provider.last().resolve(tokenAt(45));
        await tick();
        expect(ref.store.hasSomeSemanticTokens()).toBe(true);
        await configuration.updateValue(SEMANTIC_HIGHLIGHTING_SETTING_ID, false);
        await tick(150);
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
        expect(provider.calls).toHaveLength(1);
    });

    it("выключено и токенов нет — хранилище не трогается", async () => {
        const { provider, ref, configuration } = setup();
        await configuration.updateValue(SEMANTIC_HIGHLIGHTING_SETTING_ID, false);
        const listener = vi.fn();
        ref.store.onDidChange(listener);
        await tick(1000);
        expect(listener).not.toHaveBeenCalled();
        expect(provider.calls).toHaveLength(0);
    });

    it("провайдер снят — частичные токены стираются", async () => {
        const { provider, ref, registration } = setup();
        await tick(150);
        provider.last().resolve(tokenAt(45));
        await tick();
        registration.dispose();
        await tick(150);
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
    });

    it("пауза адаптируется под время ответа (100–500 мс)", async () => {
        const { provider, scroll } = setup();
        await tick(150);
        await tick(400);
        provider.last().resolve(null);
        await tick();
        scroll.fire();
        await tick(399);
        expect(provider.calls).toHaveLength(1);
        await tick(1);
        expect(provider.calls).toHaveLength(2);
    });

    it("dispose отменяет запросы и снимает подписки", async () => {
        const { provider, scroll, view } = setup();
        await tick(150);
        const inFlight = provider.last();
        view.dispose();
        expect(inFlight.token.isCancellationRequested).toBe(true);
        scroll.fire();
        await tick(1000);
        expect(provider.calls).toHaveLength(1);
    });
});
