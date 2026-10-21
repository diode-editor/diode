import { describe, expect, it, vi } from "vitest";

import { encodedResult, markedMetadata } from "../../../../TestUtils/encodedTokens.ts";
import { createInsertEdit } from "../core/iTextEdit.ts";
import type { EncodedTokenizationResult, ITokenizationSupport } from "../languages.ts";
import type { IState } from "../languages/iState.ts";
import { TextDocument } from "../model/textDocument.ts";

import { DocumentTokenStore } from "./documentTokenStore.ts";

/** Offset from the default colors. */
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

/** `>` after the indent bumps the counter; the token foreground is the incoming state. */
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

/** Store with no chance for the background to interfere: the test is synchronous, setImmediate never runs. */
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
    it("viewport at file start: exact tokens at once, nothing below it", () => {
        const { store } = createStore(lines(100));
        store.tokenizeViewport(0, 9);
        for (let line = 0; line <= 9; line++) expect(store.hasAccurateTokensForLine(line)).toBe(true);
        expect(store.getLineTokens(9)).toBeDefined();
        expect(store.getLineTokens(10)).toBeUndefined();
    });

    it("viewport at the end of 200k lines (Ctrl+End): only its lines are computed, not the whole file", () => {
        const { doc, store, tokenizer } = createStore(lines(200_000));
        store.tokenizeViewport(doc.lineCount - 50, doc.lineCount - 1);

        expect(tokenizer.tokenized).toHaveLength(50);
        expect(store.getLineTokens(doc.lineCount - 1)).toBeDefined();
        expect(store.getLineTokens(doc.lineCount - 51)).toBeUndefined();
        expect(store.hasAccurateTokensForLine(doc.lineCount - 1)).toBe(false);
    });

    it("start state is guessed from less-indented lines above the viewport", () => {
        const text = [...lines(50, "a"), ">block", ...lines(49, "  body")];
        const { store, tokenizer } = createStore(text);

        store.tokenizeViewport(90, 95);

        // Besides the viewport only the indentation "parent" line is tokenized.
        expect(tokenizer.tokenized).toEqual([">block", ...lines(6, "  body")]);
        expect(store.getLineTokens(90)?.getForeground(0)).toBe(stateMark(1));
    });

    it("empty lines above the viewport do not break the guess, tab counts as indent", () => {
        // An empty line is not a "parent" (column 0) — the walk continues up to `>block`.
        const text = [...lines(50, "a"), ">block", "", ...lines(48, "\tbody")];
        const { store, tokenizer } = createStore(text);

        store.tokenizeViewport(90, 95);

        expect(tokenizer.tokenized).toEqual([">block", ...lines(6, "\tbody")]);
        expect(store.getLineTokens(90)?.getForeground(0)).toBe(stateMark(1));
    });

    it("viewport grew (resize): new lines are guessed too", () => {
        const { store } = createStore(lines(1000));
        store.tokenizeViewport(900, 909);
        expect(store.getLineTokens(915)).toBeUndefined();

        store.tokenizeViewport(900, 919);
        expect(store.getLineTokens(915)).toBeDefined();
    });

    it("background retokenizes the guess: exactly the viewport lines, even when it converged earlier", async () => {
        const { doc, store, tokenizer } = createStore([">", ...lines(999)]);
        store.forceTokenization(doc.lineCount - 1);
        doc.applyEdits([createInsertEdit(0, 1, "x")]);

        // No indentation — the initial state is guessed, i.e. wrongly (state mark 0 instead of 1).
        store.tokenizeViewport(900, 909);
        expect(store.getLineTokens(909)?.getForeground(0)).toBe(stateMark(0));

        tokenizer.tokenized.length = 0;
        const deadline = Date.now() + 2000;
        // An edit doesn't reset the "finished" flag (as in upstream) — wait for the line itself.
        while (!store.hasAccurateTokensForLine(909)) {
            if (Date.now() > deadline) throw new Error("background did not finish in 2 s");
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        // The edited line plus ten guessed ones — and nothing more.
        expect(tokenizer.tokenized).toHaveLength(11);
        expect(store.getLineTokens(900)?.getForeground(0)).toBe(stateMark(1));
        expect(store.getLineTokens(909)?.getForeground(0)).toBe(stateMark(1));
        store.dispose();
    });

    it("sync catch-up to the end of file marks tokenization complete by itself", () => {
        const viewport = createStore(lines(10));
        viewport.store.tokenizeViewport(0, 9);
        expect(viewport.store.isBackgroundTokenizationCompleted).toBe(true);

        const caret = createStore(lines(10));
        caret.store.forceTokenization(9);
        expect(caret.store.isBackgroundTokenizationCompleted).toBe(true);
    });

    it("same viewport of the same version is not guessed twice", () => {
        const { doc, store, tokenizer } = createStore(lines(1000));
        store.tokenizeViewport(900, 909);
        const calls = tokenizer.tokenized.length;

        store.tokenizeViewport(900, 909);
        expect(tokenizer.tokenized).toHaveLength(calls);

        store.tokenizeViewport(901, 910);
        expect(tokenizer.tokenized.length).toBeGreaterThan(calls);

        // Same for an edit: the edited line is empty until recomputed.
        const afterScroll = tokenizer.tokenized.length;
        doc.applyEdits([createInsertEdit(905, 0, "y")]);
        expect(store.getLineTokens(905)).toBeUndefined();
        store.tokenizeViewport(901, 910);
        expect(tokenizer.tokenized.length).toBeGreaterThan(afterScroll);
        expect(store.getLineTokens(905)).toBeDefined();
    });

    it("edit on the bottom viewport line retokenizes it for the frame without waiting for the background", () => {
        // The bottom line is exactly the first invalid one: upstream doesn't touch it, but our edit cleared the cache.
        const { doc, store } = createStore(lines(10));
        store.tokenizeViewport(0, 9);
        doc.applyEdits([createInsertEdit(9, 0, "y")]);
        expect(store.getLineTokens(9)).toBeUndefined();

        store.tokenizeViewport(0, 9);
        expect(store.getLineTokens(9)).toBeDefined();
        expect(store.hasAccurateTokensForLine(9)).toBe(true);
    });

    it("sends no events for render (it reads tokens itself), catch-up at the cursor does", () => {
        const { store } = createStore(lines(100));
        const listener = vi.fn();
        store.onDidChangeTokens(listener);

        store.tokenizeViewport(0, 9);
        store.tokenizeViewport(50, 59);
        expect(listener).not.toHaveBeenCalled();

        store.forceTokenization(20);
        expect(listener).toHaveBeenCalledWith({ fromLine: 10, toLine: 20 });
    });

    it("viewport entirely in the exact part: the tokenizer is not called", () => {
        const { store, tokenizer } = createStore(lines(100));
        store.forceTokenization(50);
        const calls = tokenizer.tokenized.length;
        store.tokenizeViewport(10, 20);
        expect(tokenizer.tokenized).toHaveLength(calls);
    });
});

describe("DocumentTokenStore.tokenizeIfCheap", () => {
    it("past the frontier computes nothing: a full pass up to the cursor is expensive", () => {
        const { store, tokenizer } = createStore(lines(1000));
        store.tokenizeIfCheap(900);
        expect(tokenizer.tokenized).toHaveLength(0);
        expect(store.getLineTokens(900)).toBeUndefined();
    });

    it("first invalid line is cheap: computes it", () => {
        const { store } = createStore(lines(1000));
        store.forceTokenization(9);
        store.tokenizeIfCheap(10);
        expect(store.hasAccurateTokensForLine(10)).toBe(true);
    });

    it("too long first invalid line is no longer cheap", () => {
        const { store } = createStore(["a", "x".repeat(4096)]);
        store.forceTokenization(0);
        store.tokenizeIfCheap(1);
        expect(store.getLineTokens(1)).toBeUndefined();
    });
});
