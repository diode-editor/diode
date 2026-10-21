import { afterEach, describe, expect, it, vi } from "vitest";

import { encodedResult, markedMetadata } from "../../../../TestUtils/encodedTokens.ts";
import { setUnexpectedErrorHandler } from "../../../base/common/errors.ts";
import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";
import type { EncodedTokenizationResult, ITokenizationSupport } from "../languages.ts";
import type { IState } from "../languages/iState.ts";
import { TextDocument } from "../model/textDocument.ts";

import type { ITokensChangedEvent } from "./documentTokenStore.ts";
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

/** `>` bumps the counter; the token foreground is the incoming state. */
class StatefulTokenizer implements ITokenizationSupport {
    public constructor(private readonly onLine: () => void = () => undefined) {}
    public getInitialState(): IState {
        return new CounterState(0);
    }
    public tokenizeEncoded(line: string, _hasEOL: boolean, state: IState): EncodedTokenizationResult {
        this.onLine();
        const counter = (state as CounterState).value;
        const next = line.startsWith(">") ? new CounterState(counter + 1) : new CounterState(counter);
        return encodedResult([[0, markedMetadata(stateMark(counter))]], next);
    }
}

const lines = (count: number, line = "x"): TextDocument =>
    new TextDocument(new Array<string>(count).fill(line).join("\n"));

/**
 * The deadline is mandatory: without it a mutant would keep spinning the loop past the test timeout —
 * the mutation run hangs (docs/TESTING.md: cut such a test off with a counter).
 */
async function until(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error("background did not finish in 2 s");
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

const untilBackgroundCompleted = (store: DocumentTokenStore): Promise<void> =>
    until(() => store.isBackgroundTokenizationCompleted);

afterEach(() => {
    vi.useRealTimers();
});

describe("DocumentTokenStore: background tokenization", () => {
    it("tokenizes the whole document without a single render request and reports lines", async () => {
        const doc = lines(300);
        const store = new DocumentTokenStore(doc, new StatefulTokenizer());
        const reported = new Set<number>();
        store.onDidChangeTokens(({ fromLine, toLine }: ITokensChangedEvent) => {
            for (let line = fromLine; line <= toLine; line++) reported.add(line);
        });
        expect(store.getLineTokens(0)).toBeUndefined();

        await untilBackgroundCompleted(store);

        for (let line = 0; line < doc.lineCount; line++) {
            expect(store.getLineTokens(line), `line ${String(line)}`).toBeDefined();
            expect(store.hasAccurateTokensForLine(line)).toBe(true);
        }
        expect(reported.size).toBe(doc.lineCount);
        store.dispose();
    });

    it("yields between chunks: one queue turn covers ~1 ms of lines, not the whole file", () => {
        vi.useFakeTimers();
        // A line "costs" 1 ms of fake time: the chunk stops after the second line.
        const doc = lines(100);
        const store = new DocumentTokenStore(
            doc,
            new StatefulTokenizer(() => {
                vi.setSystemTime(Date.now() + 1);
            }),
        );

        vi.advanceTimersToNextTimer();
        expect(store.getLineTokens(1)).toBeDefined();
        expect(store.getLineTokens(2)).toBeUndefined();

        vi.runAllTimers();
        expect(store.isBackgroundTokenizationCompleted).toBe(true);
        expect(store.getLineTokens(99)).toBeDefined();
        store.dispose();
    });

    it("edit that changed state retokenizes the tail in the background", async () => {
        const doc = lines(50);
        const store = new DocumentTokenStore(doc, new StatefulTokenizer());
        await untilBackgroundCompleted(store);
        expect(store.getLineTokens(49)?.getForeground(0)).toBe(stateMark(0));

        doc.applyEdits([createInsertEdit(0, 0, ">")]);
        expect(store.hasAccurateTokensForLine(49)).toBe(false);
        await until(() => store.hasAccurateTokensForLine(49));
        expect(store.getLineTokens(49)?.getForeground(0)).toBe(stateMark(1));
        store.dispose();
    });

    it("edits mid-file: after catching up to the end the background has nothing to do and does not throw", () => {
        vi.useFakeTimers();
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        try {
            const onLine = vi.fn();
            const doc = lines(10);
            const store = new DocumentTokenStore(doc, new StatefulTokenizer(onLine));
            store.forceTokenization(9);

            doc.applyEdits([createInsertEdit(5, 0, "y")]);
            doc.applyEdits([createInsertEdit(7, 0, "a\nb\n")]);
            doc.applyEdits([createDeleteEdit(2, 0, 4, 0)]);
            store.forceTokenization(doc.lineCount - 1);
            expect(store.hasAccurateTokensForLine(doc.lineCount - 1)).toBe(true);

            onLine.mockClear();
            vi.runAllTimers();
            expect(onLine).not.toHaveBeenCalled();
            expect(errors).toEqual([]);
            store.dispose();
        } finally {
            setUnexpectedErrorHandler((e) => {
                console.error(e);
            });
        }
    });

    it("dispose stops the background: the tokenizer is no longer called", () => {
        vi.useFakeTimers();
        const onLine = vi.fn();
        const store = new DocumentTokenStore(lines(100), new StatefulTokenizer(onLine));
        store.dispose();
        vi.runAllTimers();
        expect(onLine).not.toHaveBeenCalled();
    });

    it("tokenizer change restarts the background", async () => {
        const doc = lines(20);
        const store = new DocumentTokenStore(doc, new StatefulTokenizer());
        await untilBackgroundCompleted(store);

        const onLine = vi.fn();
        store.setTokenizationSupport(new StatefulTokenizer(onLine));
        expect(store.isBackgroundTokenizationCompleted).toBe(false);
        expect(store.getLineTokens(0)).toBeUndefined();
        await untilBackgroundCompleted(store);
        expect(onLine).toHaveBeenCalledTimes(doc.lineCount);
        store.dispose();
    });
});
