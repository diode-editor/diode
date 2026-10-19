import { describe, expect, it } from "vitest";

import { createInsertEdit } from "../core/iTextEdit.ts";
import { PlainTextTokenizer } from "../languages/builtin/plainTextTokenizer.ts";
import { TextDocument } from "../model/textDocument.ts";

import { DocumentTokenStore } from "./documentTokenStore.ts";

describe("DocumentTokenStore invalidation", () => {
    it("invalidates the edited line on a single-line edit", () => {
        const doc = new TextDocument("aaa\nbbb\nccc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(2);
        expect(store.getLineTokens(1)).toBeDefined();

        doc.applyEdits([createInsertEdit(1, 1, "X")]);

        expect(store.getLineTokens(1)).toBeUndefined();
        // Lines outside the change keep their cached tokens.
        expect(store.getLineTokens(0)).toBeDefined();
        expect(store.getLineTokens(2)).toBeDefined();
    });

    it("the edited line and everything below lose accuracy, lines above keep it", () => {
        const doc = new TextDocument("aaa\nbbb\nccc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(2);
        expect(store.hasAccurateTokensForLine(2)).toBe(true);

        doc.applyEdits([createInsertEdit(1, 0, "Z")]);
        expect(store.hasAccurateTokensForLine(0)).toBe(true);
        expect(store.hasAccurateTokensForLine(1)).toBe(false);
        expect(store.hasAccurateTokensForLine(2)).toBe(false);
    });

    it("invalidates every line in the changed range on a multi-line insert", () => {
        const doc = new TextDocument("a\nb\nc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(2);

        doc.applyEdits([createInsertEdit(1, 0, "X\nY\n")]);
        // After insert: a, X, Y, b, c
        expect(store.getLineTokens(1)).toBeUndefined();
        expect(store.getLineTokens(2)).toBeUndefined();
        expect(store.getLineTokens(3)).toBeUndefined();
        // Line 0 and the line after the inserted block are still valid.
        expect(store.getLineTokens(0)).toBeDefined();
        expect(store.getLineTokens(4)).toBeDefined();
    });

    it("setTokenizationSupport invalidates the entire cache", () => {
        const doc = new TextDocument("a\nb\nc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(2);
        expect(store.hasAccurateTokensForLine(0)).toBe(true);

        store.setTokenizationSupport(new PlainTextTokenizer());

        expect(store.hasAccurateTokensForLine(0)).toBe(false);
        expect(store.getLineTokens(0)).toBeUndefined();
    });
});
