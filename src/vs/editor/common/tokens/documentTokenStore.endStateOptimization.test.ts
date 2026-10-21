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

/** `>` bumps the counter; other lines pass the state through as is. */
class StatefulTokenizer implements ITokenizationSupport {
    public getInitialState(): IState {
        return new CounterState(0);
    }
    public tokenizeEncoded(line: string, _hasEOL: boolean, state: IState): EncodedTokenizationResult {
        const counter = (state as CounterState).value;
        const next = line.startsWith(">") ? new CounterState(counter + 1) : new CounterState(counter);
        return encodedResult([[0, markedMetadata(stateMark(counter))]], next);
    }
}

describe("DocumentTokenStore end-state optimisation", () => {
    it("stops re-tokenizing once endState equals the previously cached one", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const tokenizer = new StatefulTokenizer();
        const store = new DocumentTokenStore(doc, tokenizer);
        store.forceTokenization(doc.lineCount - 1);

        doc.applyEdits([createInsertEdit(0, 0, "X")]);

        const spy = vi.spyOn(tokenizer, "tokenizeEncoded");
        store.forceTokenization(doc.lineCount - 1);
        // The old end-state of line 0 survives the edit (as in upstream TokenizationStateStore)
        // and equals the new one — line 1 stays valid.
        expect(spy).toHaveBeenCalledTimes(1);
        expect(store.hasAccurateTokensForLine(doc.lineCount - 1)).toBe(true);
    });

    it("continues tokenizing when the endState changes", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const tokenizer = new StatefulTokenizer();
        const store = new DocumentTokenStore(doc, tokenizer);
        store.forceTokenization(doc.lineCount - 1);

        doc.applyEdits([createInsertEdit(0, 0, ">")]);

        const spy = vi.spyOn(tokenizer, "tokenizeEncoded");
        store.forceTokenization(doc.lineCount - 1);
        expect(spy).toHaveBeenCalledTimes(doc.lineCount);
    });
});
