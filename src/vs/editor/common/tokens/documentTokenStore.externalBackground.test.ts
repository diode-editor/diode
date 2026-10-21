import { describe, expect, it, vi } from "vitest";

import { encodedResult, markedMetadata } from "../../../../TestUtils/encodedTokens.ts";
import type {
    EncodedTokenizationResult,
    IBackgroundTokenizationStore,
    IBackgroundTokenizer,
    ITokenizationSupport,
} from "../languages.ts";
import type { IState } from "../languages/iState.ts";
import { TextDocument } from "../model/textDocument.ts";

import { ContiguousMultilineTokensBuilder } from "./contiguousMultilineTokensBuilder.ts";
import { DocumentTokenStore } from "./documentTokenStore.ts";

class CounterState implements IState {
    public constructor(public readonly value: number) {}
    public clone(): IState {
        return new CounterState(this.value);
    }
    public equals(other: IState): boolean {
        return other instanceof CounterState && other.value === this.value;
    }
}

/** Цвет токена — входящее состояние строки; строки с `>` сдвигают счётчик. */
const MAIN_MARK = 10;
const BACKGROUND_MARK = 50;

/**
 * Токенизатор с собственным фоном (как TextMate с воркером): фон отдаёт
 * управление тесту — тот сам решает, когда «воркер» ответил.
 */
class SupportWithBackground implements ITokenizationSupport {
    public store: IBackgroundTokenizationStore | undefined;
    public readonly requested: [number, number][] = [];
    public readonly disposed = vi.fn();
    public tokenizedLines = 0;
    public cold = true;
    public offerBackground = true;

    public get isCold(): boolean {
        return this.cold;
    }

    public getInitialState(): IState {
        return new CounterState(0);
    }

    public tokenizeEncoded(line: string, _hasEOL: boolean, state: IState): EncodedTokenizationResult {
        this.cold = false;
        this.tokenizedLines++;
        const counter = (state as CounterState).value;
        const next = new CounterState(line.startsWith(">") ? counter + 1 : counter);
        return encodedResult([[0, markedMetadata(MAIN_MARK + counter)]], next);
    }

    public createBackgroundTokenizer(
        _document: unknown,
        store: IBackgroundTokenizationStore,
    ): IBackgroundTokenizer | undefined {
        if (!this.offerBackground) return undefined;
        this.store = store;
        return {
            dispose: this.disposed,
            requestTokens: (start, endExclusive) => {
                this.requested.push([start, endExclusive]);
            },
        };
    }

    /** Ответ «воркера»: строки `[from, to]` (с 1) с состоянием `counter` на концах. */
    public answer(from: number, to: number, counter = 0): void {
        const builder = new ContiguousMultilineTokensBuilder();
        for (let lineNumber = from; lineNumber <= to; lineNumber++) {
            this.store!.setEndState(lineNumber, new CounterState(counter));
            builder.add(lineNumber, new Uint32Array([1, markedMetadata(BACKGROUND_MARK + counter)]));
        }
        this.store!.setTokens(builder.finalize());
    }
}

const lines = (count: number): TextDocument => new TextDocument(new Array<string>(count).fill("x").join("\n"));

describe("DocumentTokenStore — фон токенизатора вне главного потока", () => {
    it("холодный токенизатор: вьюпорт ждёт ответа фона, а не компилирует грамматику в кадре", () => {
        const support = new SupportWithBackground();
        const store = new DocumentTokenStore(lines(30), support);

        store.tokenizeViewport(0, 9);
        expect(support.tokenizedLines).toBe(0);
        expect(store.getLineTokens(0)).toBeUndefined();

        support.answer(1, 10);
        expect(store.getLineTokens(0)?.getForeground(0)).toBe(BACKGROUND_MARK);
        expect(store.hasAccurateTokensForLine(9)).toBe(true);
        store.dispose();
    });

    it("тёплый токенизатор красит вьюпорт сам, не дожидаясь фона (смена темы без кадра без цвета)", () => {
        const support = new SupportWithBackground();
        support.cold = false;
        const store = new DocumentTokenStore(lines(30), support);

        store.tokenizeViewport(0, 9);
        expect(store.getLineTokens(9)?.getForeground(0)).toBe(MAIN_MARK);
        store.dispose();
    });

    it("состояния фона принимаются только за фронтиром: строки, что вьюпорт уже посчитал точно, фон не перетирает", () => {
        const support = new SupportWithBackground();
        support.cold = false;
        const doc = lines(30);
        const store = new DocumentTokenStore(doc, support);
        store.tokenizeViewport(0, 4);
        const ownState = store.getEndState(2);

        support.answer(1, 10, 7);
        // Строки 1–5 вьюпорт посчитал сам — их состояния прежние; дальше — фон.
        expect(store.getEndState(2)).toBe(ownState);
        expect((store.getEndState(7) as CounterState).value).toBe(7);
        store.dispose();
    });

    it("фон закончил — флаг «готово»; эвристика вьюпорта за фронтиром просит фон перекрасить строки", () => {
        const support = new SupportWithBackground();
        support.cold = false;
        const store = new DocumentTokenStore(lines(100), support);

        store.tokenizeViewport(80, 89);
        expect(support.requested).toEqual([[81, 91]]);

        support.store!.backgroundTokenizationFinished();
        expect(store.isBackgroundTokenizationCompleted).toBe(true);
        store.dispose();
    });

    it("первый ответ фона греет холодный токенизатор на строках вьюпорта, когда поток свободен", async () => {
        const support = new SupportWithBackground();
        const store = new DocumentTokenStore(lines(30), support);
        store.tokenizeViewport(0, 9);

        support.answer(1, 10);
        expect(support.tokenizedLines).toBe(0);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(support.tokenizedLines).toBe(10);
        expect(support.isCold).toBe(false);
        // Прогрев в кэш не пишет: токены — от фона.
        expect(store.getLineTokens(0)?.getForeground(0)).toBe(BACKGROUND_MARK);
        store.dispose();
    });

    it("нет своего фона — фон в главном потоке, как раньше", async () => {
        const support = new SupportWithBackground();
        support.offerBackground = false;
        const store = new DocumentTokenStore(lines(30), support);

        await vi.waitFor(() => {
            expect(store.isBackgroundTokenizationCompleted).toBe(true);
        });
        expect(store.getLineTokens(29)?.getForeground(0)).toBe(MAIN_MARK);
        store.dispose();
    });

    it("смена токенизатора и dispose снимают фон", () => {
        const support = new SupportWithBackground();
        const store = new DocumentTokenStore(lines(5), support);
        store.setTokenizationSupport(new SupportWithBackground());
        expect(support.disposed).toHaveBeenCalledTimes(1);
        store.dispose();
    });
});
