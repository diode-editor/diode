import { describe, expect, it } from "vitest";

import { createDeleteEdit } from "../core/iTextEdit.ts";
import { PlainTextTokenizer } from "../languages/builtin/plainTextTokenizer.ts";
import { TextDocument } from "../model/textDocument.ts";

import { DocumentTokenStore } from "./documentTokenStore.ts";

describe("DocumentTokenStore.getEndState", () => {
    it("returns the cached end state of a tokenized line", () => {
        const doc = new TextDocument("a\nb\nc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());

        // Before tokenization there is no cached end state.
        expect(store.getEndState(0)).toBeUndefined();

        store.forceTokenization(2);

        // PlainTextTokenizer is stateless, so every line ends in the NULL_STATE singleton.
        const s0 = store.getEndState(0);
        expect(s0).toBeDefined();
        expect(s0!.equals(s0!)).toBe(true);
        expect(store.getEndState(2)).toBeDefined();
    });
});

describe("DocumentTokenStore.handleContentChange — точность после удаления", () => {
    it("многострочное удаление: строки выше точны, сама правка и ниже — нет", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(4);
        expect(store.hasAccurateTokensForLine(4)).toBe(true);

        // Delete lines 2..4 (range (2,0)-(4,0)): a, b, e.
        doc.applyEdits([createDeleteEdit(2, 0, 4, 0)]);
        expect(store.hasAccurateTokensForLine(1)).toBe(true);
        expect(store.hasAccurateTokensForLine(2)).toBe(false);

        store.forceTokenization(doc.lineCount - 1);
        expect(store.hasAccurateTokensForLine(doc.lineCount - 1)).toBe(true);
        expect(store.getLineTokens(2)).toBeDefined();
    });

    it("правка, схлопнувшая хвост на строку 0, оставляет её неточной до пересчёта", () => {
        const doc = new TextDocument("a\nb\nc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(2);

        // Delete the final two lines, collapsing onto line 0.
        doc.applyEdits([createDeleteEdit(0, 1, 2, 1)]);
        expect(doc.lineCount).toBe(1);
        expect(store.hasAccurateTokensForLine(0)).toBe(false);
        store.forceTokenization(0);
        expect(store.hasAccurateTokensForLine(0)).toBe(true);
    });
});

describe("DocumentTokenStore.setLineTokens — out-of-range guard", () => {
    it("ignores line indices below 0 and at/above lineCount", () => {
        const doc = new TextDocument("a\nb");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        const custom = { tokens: [{ startIndex: 0, scopes: ["custom"] }] };

        // lineCount is 2 → indices -1 and 2 are out of range and must be ignored.
        store.setLineTokens(-1, custom);
        store.setLineTokens(2, custom);

        expect(store.getLineTokens(0)).toBeUndefined();
        expect(store.getLineTokens(1)).toBeUndefined();
    });
});

describe("DocumentTokenStore.forceTokenization — resume from a middle line", () => {
    it("seeds the state from the preceding line's end state when resuming below line 0", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());

        // Tokenize only [0..1]: the untouched tail stays inaccurate.
        store.forceTokenization(1);
        expect(store.hasAccurateTokensForLine(1)).toBe(true);
        expect(store.hasAccurateTokensForLine(2)).toBe(false);
        expect(store.getLineTokens(3)).toBeUndefined();

        // Resuming starts at line 2, seeded from line 1's end state.
        store.forceTokenization(3);
        expect(store.getLineTokens(2)).toBeDefined();
        expect(store.getLineTokens(3)).toBeDefined();
        expect(store.hasAccurateTokensForLine(3)).toBe(true);
        expect(store.hasAccurateTokensForLine(4)).toBe(false);
    });
});

describe("DocumentTokenStore.emptyLineTokens", () => {
    it("returns a single whole-line token with empty scopes", () => {
        const empty = DocumentTokenStore.emptyLineTokens();
        expect(empty.tokens).toEqual([{ startIndex: 0, scopes: [] }]);
    });

    it("returns the same shared singleton on every call", () => {
        expect(DocumentTokenStore.emptyLineTokens()).toBe(DocumentTokenStore.emptyLineTokens());
    });
});
