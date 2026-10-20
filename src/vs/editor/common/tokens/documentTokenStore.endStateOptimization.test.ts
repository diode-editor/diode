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

/**
 * Tokenizer whose end-state mirrors the line content: lines starting with
 * `>` increment the counter, anything else passes the previous state through.
 * Lets us construct scenarios where edits keep / change the boundary state.
 */
class StatefulTokenizer implements ITokenizationSupport {
    public getInitialState(): IState {
        return new CounterState(0);
    }
    public tokenizeLine(line: string, state: IState): ITokenizationResult {
        const counter = (state as CounterState).value;
        const next = line.startsWith(">") ? new CounterState(counter + 1) : new CounterState(counter);
        return {
            tokens: { tokens: [{ startIndex: 0, scopes: [`s${String(counter)}`] }] },
            endState: next,
        };
    }
}

describe("DocumentTokenStore end-state optimisation", () => {
    it("stops re-tokenizing once endState equals the previously cached one", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const tokenizer = new StatefulTokenizer();
        const store = new DocumentTokenStore(doc, tokenizer);
        store.forceTokenization(doc.lineCount - 1);

        // Edit line 0 with another non-`>` line → endState stays { value: 0 }.
        doc.applyEdits([createInsertEdit(0, 0, "X")]);

        const spy = vi.spyOn(tokenizer, "tokenizeLine");
        store.forceTokenization(doc.lineCount - 1);
        // Line 0 is the invalidated region (always re-tokenized). Its old end
        // state survives the edit (upstream TokenizationStateStore keeps it), the
        // new one equals it — so line 1 stays valid and we stop. Total: 1 call.
        expect(spy).toHaveBeenCalledTimes(1);
        expect(store.hasAccurateTokensForLine(doc.lineCount - 1)).toBe(true);
    });

    it("continues tokenizing when the endState changes", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const tokenizer = new StatefulTokenizer();
        const store = new DocumentTokenStore(doc, tokenizer);
        store.forceTokenization(doc.lineCount - 1);

        // Edit line 0 to a `>` line → endState changes to { value: 1 }, propagates downstream.
        doc.applyEdits([createInsertEdit(0, 0, ">")]);

        const spy = vi.spyOn(tokenizer, "tokenizeLine");
        store.forceTokenization(doc.lineCount - 1);
        // Every line must be re-tokenized.
        expect(spy).toHaveBeenCalledTimes(doc.lineCount);
    });
});
