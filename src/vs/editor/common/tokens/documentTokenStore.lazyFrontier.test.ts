import { describe, expect, it } from "vitest";

import { encodedResult, markedMetadata } from "../../../../TestUtils/encodedTokens.ts";
import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";
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

/** `>` bumps the counter; the token foreground is the incoming state. */
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

const tenLines = (): TextDocument => new TextDocument("a\nb\nc\nd\ne\nf\ng\nh\ni\nj");

// An early exit on a converged end-state must not declare a never-tokenized tail valid.
describe("DocumentTokenStore — виден только вьюпорт", () => {
    it("после правки выше вьюпорта хвост всё ещё токенизируется", () => {
        const doc = tenLines();
        const store = new DocumentTokenStore(doc, new StatefulTokenizer());

        store.forceTokenization(3);
        expect(store.getLineTokens(4)).toBeUndefined();

        doc.applyEdits([createInsertEdit(0, 0, "X")]);
        store.forceTokenization(3);

        store.forceTokenization(doc.lineCount - 1);
        for (let line = 0; line < doc.lineCount; line++) {
            expect(store.getLineTokens(line), `строка ${String(line)}`).toBeDefined();
        }
    });

    it("правка в нетокенизированном хвосте не оставляет дыру выше курсора", () => {
        const doc = new TextDocument("a\n>b\nc\nd\ne\nf\ng\nh\ni\nj");
        const store = new DocumentTokenStore(doc, new StatefulTokenizer());

        store.forceTokenization(3);
        doc.applyEdits([createInsertEdit(0, 0, "X")]);
        store.forceTokenization(3);

        doc.applyEdits([createInsertEdit(7, 0, "Y")]);
        store.forceTokenization(9);

        for (let line = 0; line < doc.lineCount; line++) {
            expect(store.getLineTokens(line), `строка ${String(line)}`).toBeDefined();
        }
        expect(store.getLineTokens(9)?.getForeground(0)).toBe(stateMark(1));
    });

    it("правка, перешагнувшая фронтир, опускает его на своё начало", () => {
        const doc = tenLines();
        const store = new DocumentTokenStore(doc, new StatefulTokenizer());

        store.forceTokenization(5);
        expect(store.getLineTokens(5)).toBeDefined();
        expect(store.getLineTokens(6)).toBeUndefined();

        // The deletion starts ABOVE the frontier and ends BELOW it: the frontier must
        // drop to the edit start, otherwise the line stays without tokens forever.
        doc.applyEdits([createDeleteEdit(4, 0, 8, 0)]);
        expect(doc.getText()).toBe("a\nb\nc\nd\ni\nj");

        store.forceTokenization(4);
        expect(store.getLineTokens(5)).toBeUndefined();

        doc.applyEdits([createInsertEdit(0, 0, "X")]);
        store.forceTokenization(4);

        store.forceTokenization(5);
        expect(store.getLineTokens(5)).toBeDefined();
    });
});
