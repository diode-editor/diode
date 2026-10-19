import { describe, expect, it, vi } from "vitest";

import { createInsertEdit } from "../core/iTextEdit.ts";
import type { IState } from "../languages/iState.ts";
import type { ITokenizationResult, ITokenizationSupport } from "../languages/iTokenizationSupport.ts";
import { TextDocument } from "../model/textDocument.ts";

import { DocumentTokenStore } from "./documentTokenStore.ts";

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

/** Lines starting with `>` (after indentation) bump the counter; the scope records the incoming state. */
class StatefulTokenizer implements ITokenizationSupport {
    public readonly tokenized: string[] = [];
    public getInitialState(): IState {
        return new CounterState(0);
    }
    public tokenizeLine(line: string, state: IState): ITokenizationResult {
        this.tokenized.push(line);
        const counter = (state as CounterState).value;
        const next = line.trimStart().startsWith(">") ? new CounterState(counter + 1) : new CounterState(counter);
        return {
            tokens: { tokens: [{ startIndex: 0, scopes: [`s${String(counter)}`] }] },
            endState: next,
        };
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
        // Эвристика — не точные токены: их перепишет фон.
        expect(store.hasAccurateTokensForLine(doc.lineCount - 1)).toBe(false);
    });

    it("стартовое состояние угадано по строкам с меньшим отступом над вьюпортом", () => {
        // Блок `>block` переводит состояние в 1; тело блока — с отступом.
        const text = [...lines(50, "a"), ">block", ...lines(49, "  body")];
        const { store, tokenizer } = createStore(text);

        store.tokenizeViewport(90, 95);

        // Кроме вьюпорта токенизирована только строка-«родитель» по отступу.
        expect(tokenizer.tokenized).toEqual([">block", ...lines(6, "  body")]);
        expect(store.getLineTokens(90)?.tokens[0].scopes).toEqual(["s1"]);
    });

    it("тот же вьюпорт той же версии второй раз не угадывается", () => {
        const { doc, store, tokenizer } = createStore(lines(1000));
        store.tokenizeViewport(900, 909);
        const calls = tokenizer.tokenized.length;

        store.tokenizeViewport(900, 909);
        expect(tokenizer.tokenized).toHaveLength(calls);

        // Сдвиг вьюпорта — угадываем заново.
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
        // Нижняя строка — ровно первая невалидная: эталон считает, что «делать
        // нечего», а у нас её кэш правка очистила.
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
