import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { CancellationError } from "../../../../base/common/errorSerialization.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { createInsertEdit } from "../../../common/core/iTextEdit.ts";
import type {
    DocumentSemanticTokensProvider,
    ISemanticTokens,
    ISemanticTokensEdits,
    ISemanticTokensLegend,
} from "../../../common/languages/iSemanticTokensSource.ts";
import type { ISemanticTokenStyleResolver } from "../../../common/languages/iSemanticTokenStyleResolver.ts";
import { TextDocument } from "../../../common/model/textDocument.ts";
import { LanguageFeaturesService } from "../../../common/services/languageFeaturesService.ts";
import { SEMANTIC_HIGHLIGHTING_SETTING_ID } from "../common/semanticTokensConfig.ts";

import {
    applySemanticTokensEdits,
    DocumentSemanticTokensFeature,
    type ISemanticTokensModel,
} from "./documentSemanticTokens.ts";

const LEGEND: ISemanticTokensLegend = { tokenTypes: ["variable"], tokenModifiers: [] };

interface IPendingCall {
    readonly lastResultId: string | null;
    readonly token: ICancellationToken;
    resolve(value: ISemanticTokens | ISemanticTokensEdits | null): void;
    reject(error: unknown): void;
}

/** Провайдер с ручными ответами: каждый вызов ждёт `resolve`/`reject` теста. */
class FakeProvider implements DocumentSemanticTokensProvider {
    public readonly calls: IPendingCall[] = [];
    public readonly releases: (string | undefined)[] = [];
    public readonly changeEmitter = new Emitter<void>();
    public readonly onDidChange = this.changeEmitter.event;

    public getLegend(): ISemanticTokensLegend {
        return LEGEND;
    }

    public provideDocumentSemanticTokens(
        _request: unknown,
        lastResultId: string | null,
        token: ICancellationToken,
    ): Promise<ISemanticTokens | ISemanticTokensEdits | null> {
        return new Promise((resolve, reject) => {
            this.calls.push({ lastResultId, token, resolve, reject });
        });
    }

    public releaseDocumentSemanticTokens(resultId: string | undefined): void {
        this.releases.push(resultId);
    }

    public last(): IPendingCall {
        const call = this.calls.at(-1);
        if (call === undefined) throw new Error("no calls");
        return call;
    }
}

function full(resultId: string, ...data: number[]): ISemanticTokens {
    return { resultId, data: new Uint32Array(data) };
}

class FakeTheme implements ISemanticTokenStyleResolver {
    public semanticHighlighting = true;
    private readonly emitter = new Emitter<void>();
    public readonly onDidChange = this.emitter.event;
    public resolve(): null {
        return null;
    }
    public fire(): void {
        this.emitter.fire();
    }
}

function modelOf(document: TextDocument, path = "/w/A.java"): ISemanticTokensModel {
    return {
        document,
        uri: Uri.file(path),
        get languageId() {
            return document.languageId;
        },
        onDidChangeLanguage: document.onDidChangeLanguage,
    };
}

interface IFixture {
    readonly features: LanguageFeaturesService;
    readonly configuration: InMemoryConfigurationService;
    readonly theme: FakeTheme;
    readonly feature: DocumentSemanticTokensFeature;
    readonly provider: FakeProvider;
    readonly document: TextDocument;
    readonly model: ISemanticTokensModel;
}

function setup(selector = "*"): IFixture {
    const features = new LanguageFeaturesService();
    const configuration = createTestConfigurationService();
    const theme = new FakeTheme();
    const provider = new FakeProvider();
    features.documentSemanticTokensProvider.register(selector, provider);
    const feature = new DocumentSemanticTokensFeature(features, configuration, theme);
    const document = new TextDocument("let foo = 1;\nfoo;", "java");
    return { features, configuration, theme, feature, provider, document, model: modelOf(document) };
}

/** Дать отработать таймеру `ms` и промисам ответа. */
async function tick(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
}

describe("DocumentSemanticTokensFeature / ModelSemanticColoring", () => {
    const unexpected: unknown[] = [];

    beforeEach(() => {
        vi.useFakeTimers();
        unexpected.length = 0;
        setUnexpectedErrorHandler((e) => unexpected.push(e));
    });

    afterEach(() => {
        vi.useRealTimers();
        setUnexpectedErrorHandler((e) => {
            console.error(e);
        });
    });

    it("первый запрос — сразу; ответ ложится полным набором в хранилище", async () => {
        const { feature, provider, model } = setup();
        const ref = feature.attach(model);
        expect(provider.calls).toHaveLength(0);
        await tick();
        expect(provider.calls).toHaveLength(1);
        expect(provider.last().lastResultId).toBeNull();
        provider.last().resolve(full("1", 0, 4, 3, 0, 0, 1, 0, 3, 0, 0));
        await tick();
        expect(ref.store.getLineTokens(0)?.tokens).toEqual([4, 7, 0, 0]);
        expect(ref.store.getLineTokens(1)?.tokens).toEqual([0, 3, 0, 0]);
        expect(ref.store.getLineTokens(1)?.legend).toBe(LEGEND);
        expect(ref.store.hasCompleteSemanticTokens()).toBe(true);
        expect(feature.styleResolver).toBeInstanceOf(FakeTheme);
    });

    it("запрос несёт документ, язык и версию", async () => {
        const { feature, provider, model } = setup();
        const spy = vi.spyOn(provider, "provideDocumentSemanticTokens");
        feature.attach(model);
        await tick();
        expect(spy).toHaveBeenCalledWith(
            { uri: model.uri.toString(), languageId: "java", versionId: model.document.versionId },
            null,
            expect.anything(),
        );
    });

    it("правка — запрос после паузы с resultId прошлого ответа; прошлый ответ отпускается по приходу нового", async () => {
        const { feature, provider, model, document } = setup();
        feature.attach(model);
        await tick();
        provider.last().resolve(full("1", 0, 4, 3, 0, 0));
        await tick();

        document.applyEdits([createInsertEdit(1, 0, "x")]);
        await tick(299);
        expect(provider.calls).toHaveLength(1);
        // Вторая правка паузу не отодвигает.
        document.applyEdits([createInsertEdit(1, 0, "y")]);
        await tick(1);
        expect(provider.calls).toHaveLength(2);
        expect(provider.last().lastResultId).toBe("1");
        expect(provider.releases).toEqual([]);
        provider.last().resolve(full("2", 0, 4, 3, 0, 0));
        await tick();
        expect(provider.releases).toEqual(["1"]);
    });

    it("дельта накладывается на данные прошлого ответа", async () => {
        const { feature, provider, model, document } = setup();
        const ref = feature.attach(model);
        await tick();
        provider.last().resolve(full("1", 0, 4, 3, 0, 0));
        await tick();
        document.applyEdits([createInsertEdit(1, 0, "")]);
        document.applyEdits([createInsertEdit(1, 3, " ")]);
        await tick(2000);
        provider.last().resolve({ resultId: "2", edits: [{ start: 1, deleteCount: 1, data: new Uint32Array([0]) }] });
        await tick();
        expect(ref.store.getLineTokens(0)?.tokens).toEqual([0, 3, 0, 0]);

        // Пустая дельта — прежние данные; дальше считается от них же.
        document.applyEdits([createInsertEdit(1, 4, " ")]);
        await tick(2000);
        expect(provider.last().lastResultId).toBe("2");
        provider.last().resolve({ resultId: "3", edits: [] });
        await tick();
        expect(ref.store.getLineTokens(0)?.tokens).toEqual([0, 3, 0, 0]);
        expect(provider.releases).toEqual(["1", "2"]);
    });

    it("дельта без прошлого ответа или с правкой за концом данных — токены стёрты", async () => {
        const { feature, provider, model, document } = setup();
        const ref = feature.attach(model);
        await tick();
        provider.last().resolve({ resultId: "1", edits: [] });
        await tick();
        expect(ref.store.hasCompleteSemanticTokens()).toBe(true);
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);

        document.applyEdits([createInsertEdit(1, 0, " ")]);
        await tick(2000);
        provider.last().resolve(full("2", 0, 4, 3, 0, 0));
        await tick();
        expect(ref.store.hasSomeSemanticTokens()).toBe(true);
        document.applyEdits([createInsertEdit(1, 0, " ")]);
        await tick(2000);
        provider.last().resolve({ resultId: "3", edits: [{ start: 6, deleteCount: 0, data: new Uint32Array([1]) }] });
        await tick();
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
        expect(ref.store.hasCompleteSemanticTokens()).toBe(true);
    });

    it("правка во время запроса сдвигает пришедшие токены и вызывает перезапрос", async () => {
        const { feature, provider, model, document } = setup();
        const ref = feature.attach(model);
        await tick();
        document.applyEdits([createInsertEdit(0, 0, "ab")]);
        // Запрос в полёте — новый не уходит даже после паузы.
        await tick(2000);
        expect(provider.calls).toHaveLength(1);
        provider.last().resolve(full("1", 0, 4, 3, 0, 0));
        await tick();
        expect(ref.store.getLineTokens(0)?.tokens).toEqual([6, 9, 0, 0]);
        await tick(2000);
        expect(provider.calls).toHaveLength(2);
    });

    it("пустой ответ — токенов нет, но набор полный; при правках в полёте — перезапрос", async () => {
        const { feature, provider, model, document } = setup();
        const ref = feature.attach(model);
        await tick();
        document.applyEdits([createInsertEdit(0, 0, "a")]);
        provider.last().resolve(null);
        await tick();
        expect(ref.store.hasCompleteSemanticTokens()).toBe(true);
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
        await tick(2000);
        expect(provider.calls).toHaveLength(2);
        provider.last().resolve(null);
        await tick(5000);
        expect(provider.calls).toHaveLength(2);
    });

    it("ошибка оставляет прежние токены; с правками в полёте — перезапрос, без них — нет", async () => {
        const { feature, provider, model, document } = setup();
        const ref = feature.attach(model);
        await tick();
        provider.last().resolve(full("1", 0, 4, 3, 0, 0));
        await tick();
        document.applyEdits([createInsertEdit(1, 0, " ")]);
        await tick(2000);
        provider.last().reject(new Error("server crashed"));
        await tick(5000);
        expect(ref.store.getLineTokens(0)?.tokens).toEqual([4, 7, 0, 0]);
        expect(provider.calls).toHaveLength(2);
        expect(unexpected).toHaveLength(1);

        document.applyEdits([createInsertEdit(1, 0, " ")]);
        await tick(2000);
        document.applyEdits([createInsertEdit(1, 0, " ")]);
        provider.last().reject(new Error("server busy"));
        await tick(2000);
        expect(provider.calls).toHaveLength(4);
        expect(unexpected).toHaveLength(1);
        // Прошлый ответ по-прежнему базовый для дельты.
        expect(provider.last().lastResultId).toBe("1");
        provider.last().reject(new CancellationError());
        await tick(5000);
        expect(unexpected).toHaveLength(1);
        expect(provider.calls).toHaveLength(4);
    });

    it("отказ не-ошибкой тоже не роняет и считается непредвиденным", async () => {
        const { feature, provider, model } = setup();
        feature.attach(model);
        await tick();
        provider.last().reject({ message: 42 });
        await tick();
        // Не-Error провайдера оборачивается в Error (`getDocumentSemanticTokens`).
        expect(unexpected).toEqual([new Error("[object Object]")]);
    });

    it("смена языка: отмена запроса, release, стирание и немедленный перезапрос", async () => {
        const { feature, provider, model, document } = setup();
        const ref = feature.attach(model);
        await tick();
        provider.last().resolve(full("1", 0, 4, 3, 0, 0));
        await tick();
        document.applyEdits([createInsertEdit(1, 0, " ")]);
        await tick(2000);
        const inFlight = provider.last();
        document.setLanguage("kotlin");
        expect(inFlight.token.isCancellationRequested).toBe(true);
        expect(provider.releases).toEqual(["1"]);
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
        expect(ref.store.hasCompleteSemanticTokens()).toBe(false);
        await tick();
        expect(provider.calls).toHaveLength(3);
        expect(provider.last().lastResultId).toBeNull();
    });

    it("onDidChange провайдера — сразу перезапрос, а во время запроса — после него", async () => {
        const { feature, provider, model } = setup();
        feature.attach(model);
        await tick();
        provider.changeEmitter.fire();
        await tick();
        expect(provider.calls).toHaveLength(1);
        provider.last().resolve(full("1", 0, 4, 3, 0, 0));
        await tick();
        // Перезапрос по смене во время запроса — с паузой.
        await tick(2000);
        expect(provider.calls).toHaveLength(2);
        provider.last().resolve(full("2", 0, 4, 3, 0, 0));
        await tick();
        provider.changeEmitter.fire();
        await tick();
        expect(provider.calls).toHaveLength(3);
    });

    it("onDidChange неподходящего провайдера не слушается", async () => {
        const fixture = setup("java");
        const kotlin = new FakeProvider();
        fixture.features.documentSemanticTokensProvider.register("kotlin", kotlin);
        fixture.feature.attach(fixture.model);
        await tick();
        fixture.provider.last().resolve(null);
        await tick(5000);
        kotlin.changeEmitter.fire();
        await tick();
        expect(fixture.provider.calls).toHaveLength(1);
        expect(kotlin.calls).toHaveLength(0);
    });

    it("снятие провайдера стирает токены; без ответа снятие ничего не трогает", async () => {
        const features = new LanguageFeaturesService();
        const provider = new FakeProvider();
        const registration = features.documentSemanticTokensProvider.register("*", provider);
        const feature = new DocumentSemanticTokensFeature(features, createTestConfigurationService(), new FakeTheme());
        const ref = feature.attach(modelOf(new TextDocument("let foo;", "java")));
        await tick();
        provider.last().resolve(full("1", 0, 4, 3, 0, 0));
        await tick();
        registration.dispose();
        await tick(2000);
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
        expect(ref.store.hasCompleteSemanticTokens()).toBe(false);

        // Документ без провайдера с самого начала: запросов нет.
        const other = feature.attach(modelOf(new TextDocument("x", "java"), "/w/B.java"));
        const listener = vi.fn();
        other.store.onDidChange(listener);
        await tick(2000);
        expect(listener).not.toHaveBeenCalled();
    });

    it("регистрация нового провайдера — перезапрос после паузы", async () => {
        const { feature, provider, model, features } = setup();
        feature.attach(model);
        await tick();
        provider.last().resolve(null);
        await tick();
        const second = new FakeProvider();
        features.documentSemanticTokensProvider.register("java", second);
        await tick(2000);
        expect(second.calls).toHaveLength(1);
        expect(provider.calls).toHaveLength(1);
    });

    it("настройка выключена — запросов нет; выключение стирает и отпускает, включение — заново с нуля", async () => {
        const { feature, provider, model, configuration } = setup();
        await configuration.updateValue(SEMANTIC_HIGHLIGHTING_SETTING_ID, false);
        const ref = feature.attach(model);
        await tick(2000);
        expect(provider.calls).toHaveLength(0);

        await configuration.updateValue(SEMANTIC_HIGHLIGHTING_SETTING_ID, true);
        await tick();
        provider.last().resolve(full("1", 0, 4, 3, 0, 0));
        await tick();
        expect(ref.store.hasSomeSemanticTokens()).toBe(true);

        await configuration.updateValue(SEMANTIC_HIGHLIGHTING_SETTING_ID, false);
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
        expect(ref.store.hasCompleteSemanticTokens()).toBe(false);
        expect(provider.releases).toEqual(["1"]);

        await configuration.updateValue(SEMANTIC_HIGHLIGHTING_SETTING_ID, true);
        await tick();
        expect(provider.calls).toHaveLength(2);
        expect(provider.last().lastResultId).toBeNull();
        // Посторонняя настройка ничего не пересчитывает.
        await configuration.updateValue("editor.tabSize", 2);
        await tick();
        expect(provider.calls).toHaveLength(2);
    });

    it("флаг темы при configuredByTheme включает и выключает", async () => {
        const { feature, provider, model, theme } = setup();
        theme.semanticHighlighting = false;
        const ref = feature.attach(model);
        await tick();
        expect(provider.calls).toHaveLength(0);
        theme.semanticHighlighting = true;
        theme.fire();
        await tick();
        provider.last().resolve(full("1", 0, 4, 3, 0, 0));
        await tick();
        // Смена темы при включённой подсветке токены не стирает (стиль — при отрисовке).
        theme.fire();
        expect(ref.store.hasSomeSemanticTokens()).toBe(true);
        theme.semanticHighlighting = false;
        theme.fire();
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
    });

    it("ответ, пришедший после выключения, отпускается и не кладётся", async () => {
        const { feature, provider, model, configuration } = setup();
        const ref = feature.attach(model);
        await tick();
        const inFlight = provider.last();
        await configuration.updateValue(SEMANTIC_HIGHLIGHTING_SETTING_ID, false);
        expect(inFlight.token.isCancellationRequested).toBe(true);
        inFlight.resolve(full("7", 0, 4, 3, 0, 0));
        await tick();
        expect(provider.releases).toEqual(["7"]);
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
    });

    it("вью одного документа делят хранилище; последняя закрытая забывает документ", async () => {
        const { feature, provider, model, document } = setup();
        const first = feature.attach(model);
        const second = feature.attach(model);
        expect(second.store).toBe(first.store);
        await tick();
        expect(provider.calls).toHaveLength(1);
        provider.last().resolve(full("1", 0, 4, 3, 0, 0));
        await tick();

        first.dispose();
        first.dispose();
        document.applyEdits([createInsertEdit(0, 0, "a")]);
        expect(second.store.getLineTokens(0)?.tokens).toEqual([5, 8, 0, 0]);

        second.dispose();
        expect(provider.releases).toEqual(["1"]);
        document.applyEdits([createInsertEdit(0, 0, "a")]);
        expect(second.store.getLineTokens(0)).toBeUndefined();

        const reopened = feature.attach(model);
        expect(reopened.store).not.toBe(first.store);
        await tick();
        expect(provider.calls).toHaveLength(2);
    });

    it("dispose фичи отпускает ответы и останавливает запросы", async () => {
        const { feature, provider, model, document } = setup();
        const ref = feature.attach(model);
        await tick();
        provider.last().resolve(full("1", 0, 4, 3, 0, 0));
        await tick();
        feature.dispose();
        expect(provider.releases).toEqual(["1"]);
        expect(ref.store.hasSomeSemanticTokens()).toBe(false);
        document.applyEdits([createInsertEdit(0, 0, "a")]);
        await tick(5000);
        expect(provider.calls).toHaveLength(1);
    });
});

describe("applySemanticTokensEdits", () => {
    const src = new Uint32Array([1, 2, 3, 4, 5, 6]);
    const edits = (...list: { start: number; deleteCount: number; data?: number[] }[]): ISemanticTokensEdits => ({
        resultId: "x",
        edits: list.map((e) => ({
            start: e.start,
            deleteCount: e.deleteCount,
            data: e.data === undefined ? undefined : new Uint32Array(e.data),
        })),
    });

    it("пустые правки — те же данные", () => {
        expect(applySemanticTokensEdits(src, edits())).toBe(src);
    });

    it("замена, вставка, удаление и несколько правок в индексах старого массива", () => {
        expect(Array.from(applySemanticTokensEdits(src, edits({ start: 1, deleteCount: 2, data: [9] })) ?? [])).toEqual(
            [1, 9, 4, 5, 6],
        );
        expect(
            Array.from(applySemanticTokensEdits(src, edits({ start: 6, deleteCount: 0, data: [7, 8] })) ?? []),
        ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(Array.from(applySemanticTokensEdits(src, edits({ start: 0, deleteCount: 2 })) ?? [])).toEqual([
            3, 4, 5, 6,
        ]);
        expect(
            Array.from(
                applySemanticTokensEdits(
                    src,
                    edits({ start: 0, deleteCount: 1, data: [0, 0] }, { start: 4, deleteCount: 1, data: [] }),
                ) ?? [],
            ),
        ).toEqual([0, 0, 2, 3, 4, 6]);
    });

    it("правка за концом данных — null", () => {
        expect(applySemanticTokensEdits(src, edits({ start: 7, deleteCount: 0, data: [1] }))).toBeNull();
    });

    it("удаление за конец данных не роняет копирование (как в эталоне — результат усечён)", () => {
        // Длина результата 6 + 1 - 5 = 2: копии зажаты границами массивов.
        expect(Array.from(applySemanticTokensEdits(src, edits({ start: 4, deleteCount: 5, data: [9] })) ?? [])).toEqual(
            [1, 2],
        );
    });
});
