import { describe, expect, it, vi } from "vitest";

import { encodedResult, markedMetadata } from "../../../../TestUtils/encodedTokens.ts";
import { createInsertEdit } from "../core/iTextEdit.ts";
import type { EncodedTokenizationResult, ITokenizationSupport } from "../languages.ts";
import type { IState } from "../languages/iState.ts";
import { TextDocument } from "../model/textDocument.ts";

import { DocumentTokenStore } from "./documentTokenStore.ts";

/** Смещение от цветов по умолчанию. */
const stateMark = (counter: number): number => 10 + counter;

class CounterState implements IState {
    public readonly value: number;
    public constructor(value: number) {
        this.value = value;
    }
    public clone(): IState {
        return new CounterState(this.value);
    }
    public equals(other: IState): boolean {
        return other instanceof CounterState && other.value === this.value;
    }
}

/** `>` после отступа поднимает счётчик; foreground токена — входящее состояние. */
class StatefulTokenizer implements ITokenizationSupport {
    public readonly tokenized: string[] = [];
    public getInitialState(): IState {
        return new CounterState(0);
    }
    public tokenizeEncoded(line: string, _hasEOL: boolean, state: IState): EncodedTokenizationResult {
        this.tokenized.push(line);
        const counter = (state as CounterState).value;
        const next = line.trimStart().startsWith(">") ? new CounterState(counter + 1) : new CounterState(counter);
        return encodedResult([[0, markedMetadata(stateMark(counter))]], next);
    }
}

const lines = (count: number, line = "x"): string[] => new Array<string>(count).fill(line);

/** Store без шанса фону вмешаться: тест синхронный, setImmediate не успевает. */
function createStore(text: readonly string[]): {
    doc: TextDocument;
    store: DocumentTokenStore;
    tokenizer: StatefulTokenizer;
} {
    const doc = new TextDocument(text.join("\n"));
    const tokenizer = new StatefulTokenizer();
    return { doc, store: new DocumentTokenStore(doc, tokenizer), tokenizer };
}

describe("DocumentTokenStore.tokenizeViewport", () => {
    it("вьюпорт в начале файла — точные токены сразу, ниже него ничего", () => {
        const { store } = createStore(lines(100));
        store.tokenizeViewport(0, 9);
        for (let line = 0; line <= 9; line++) expect(store.hasAccurateTokensForLine(line)).toBe(true);
        expect(store.getLineTokens(9)).toBeDefined();
        expect(store.getLineTokens(10)).toBeUndefined();
    });

    it("вьюпорт в конце 200k строк (Ctrl+End) — считаются только его строки, не весь файл", () => {
        const { doc, store, tokenizer } = createStore(lines(200_000));
        store.tokenizeViewport(doc.lineCount - 50, doc.lineCount - 1);

        expect(tokenizer.tokenized).toHaveLength(50);
        expect(store.getLineTokens(doc.lineCount - 1)).toBeDefined();
        expect(store.getLineTokens(doc.lineCount - 51)).toBeUndefined();
        expect(store.hasAccurateTokensForLine(doc.lineCount - 1)).toBe(false);
    });

    it("стартовое состояние угадано по строкам с меньшим отступом над вьюпортом", () => {
        const text = [...lines(50, "a"), ">block", ...lines(49, "  body")];
        const { store, tokenizer } = createStore(text);

        store.tokenizeViewport(90, 95);

        // Кроме вьюпорта токенизирована только строка-«родитель» по отступу.
        expect(tokenizer.tokenized).toEqual([">block", ...lines(6, "  body")]);
        expect(store.getLineTokens(90)?.getForeground(0)).toBe(stateMark(1));
    });

    it("пустые строки над вьюпортом угадыванию не мешают, таб — тоже отступ", () => {
        // Пустая строка не «родитель» (колонка 0) — обход идёт дальше вверх к `>block`.
        const text = [...lines(50, "a"), ">block", "", ...lines(48, "\tbody")];
        const { store, tokenizer } = createStore(text);

        store.tokenizeViewport(90, 95);

        expect(tokenizer.tokenized).toEqual([">block", ...lines(6, "\tbody")]);
        expect(store.getLineTokens(90)?.getForeground(0)).toBe(stateMark(1));
    });

    it("вьюпорт вырос (ресайз) — новые строки угадываются тоже", () => {
        const { store } = createStore(lines(1000));
        store.tokenizeViewport(900, 909);
        expect(store.getLineTokens(915)).toBeUndefined();

        store.tokenizeViewport(900, 919);
        expect(store.getLineTokens(915)).toBeDefined();
    });

    it("фон перекрашивает угаданное — ровно строки вьюпорта, даже когда сошёлся раньше", async () => {
        const { doc, store, tokenizer } = createStore([">", ...lines(999)]);
        store.forceTokenization(doc.lineCount - 1);
        doc.applyEdits([createInsertEdit(0, 1, "x")]);

        // Отступов нет — угадано начальное состояние, то есть неверно (метка состояния 0 вместо 1).
        store.tokenizeViewport(900, 909);
        expect(store.getLineTokens(909)?.getForeground(0)).toBe(stateMark(0));

        tokenizer.tokenized.length = 0;
        const deadline = Date.now() + 2000;
        // Флаг «закончено» правка не сбрасывает (как у эталона) — ждём саму строку.
        while (!store.hasAccurateTokensForLine(909)) {
            if (Date.now() > deadline) throw new Error("фон не дошёл за 2 с");
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        // Правленая строка плюс десять угаданных — и ничего сверх.
        expect(tokenizer.tokenized).toHaveLength(11);
        expect(store.getLineTokens(900)?.getForeground(0)).toBe(stateMark(1));
        expect(store.getLineTokens(909)?.getForeground(0)).toBe(stateMark(1));
        store.dispose();
    });

    it("синхронная доводка до конца файла сама отмечает токенизацию законченной", () => {
        const viewport = createStore(lines(10));
        viewport.store.tokenizeViewport(0, 9);
        expect(viewport.store.isBackgroundTokenizationCompleted).toBe(true);

        const caret = createStore(lines(10));
        caret.store.forceTokenization(9);
        expect(caret.store.isBackgroundTokenizationCompleted).toBe(true);
    });

    it("тот же вьюпорт той же версии второй раз не угадывается", () => {
        const { doc, store, tokenizer } = createStore(lines(1000));
        store.tokenizeViewport(900, 909);
        const calls = tokenizer.tokenized.length;

        store.tokenizeViewport(900, 909);
        expect(tokenizer.tokenized).toHaveLength(calls);

        store.tokenizeViewport(901, 910);
        expect(tokenizer.tokenized.length).toBeGreaterThan(calls);

        // Правка — тоже: правленая строка пуста, пока её не пересчитали.
        const afterScroll = tokenizer.tokenized.length;
        doc.applyEdits([createInsertEdit(905, 0, "y")]);
        expect(store.getLineTokens(905)).toBeUndefined();
        store.tokenizeViewport(901, 910);
        expect(tokenizer.tokenized.length).toBeGreaterThan(afterScroll);
        expect(store.getLineTokens(905)).toBeDefined();
    });

    it("правка нижней строки вьюпорта — она перекрашивается к кадру, не ждёт фона", () => {
        // Нижняя строка — ровно первая невалидная: эталон её не трогает, а у нас кэш правка очистила.
        const { doc, store } = createStore(lines(10));
        store.tokenizeViewport(0, 9);
        doc.applyEdits([createInsertEdit(9, 0, "y")]);
        expect(store.getLineTokens(9)).toBeUndefined();

        store.tokenizeViewport(0, 9);
        expect(store.getLineTokens(9)).toBeDefined();
        expect(store.hasAccurateTokensForLine(9)).toBe(true);
    });

    it("рендеру событий не шлёт (он прочтёт токены сам), доводка у каретки — шлёт", () => {
        const { store } = createStore(lines(100));
        const listener = vi.fn();
        store.onDidChangeTokens(listener);

        store.tokenizeViewport(0, 9);
        store.tokenizeViewport(50, 59);
        expect(listener).not.toHaveBeenCalled();

        store.forceTokenization(20);
        expect(listener).toHaveBeenCalledWith({ fromLine: 10, toLine: 20 });
    });

    it("вьюпорт целиком в точной части — токенизатор не зовут", () => {
        const { store, tokenizer } = createStore(lines(100));
        store.forceTokenization(50);
        const calls = tokenizer.tokenized.length;
        store.tokenizeViewport(10, 20);
        expect(tokenizer.tokenized).toHaveLength(calls);
    });
});

describe("DocumentTokenStore.tokenizeIfCheap", () => {
    it("за фронтиром — ничего не считает: честный проход до каретки дорог", () => {
        const { store, tokenizer } = createStore(lines(1000));
        store.tokenizeIfCheap(900);
        expect(tokenizer.tokenized).toHaveLength(0);
        expect(store.getLineTokens(900)).toBeUndefined();
    });

    it("первая невалидная строка — дёшево: досчитывает", () => {
        const { store } = createStore(lines(1000));
        store.forceTokenization(9);
        store.tokenizeIfCheap(10);
        expect(store.hasAccurateTokensForLine(10)).toBe(true);
    });

    it("слишком длинная первая невалидная строка — уже не дёшево", () => {
        const { store } = createStore(["a", "x".repeat(4096)]);
        store.forceTokenization(0);
        store.tokenizeIfCheap(1);
        expect(store.getLineTokens(1)).toBeUndefined();
    });
});
