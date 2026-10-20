import { describe, expect, it, vi } from "vitest";

import { markedMetadata, storedTokens } from "../../../../TestUtils/encodedTokens.ts";
import { PlainTextTokenizer } from "../languages/builtin/plainTextTokenizer.ts";
import { TextDocument } from "../model/textDocument.ts";

import { DocumentTokenStore } from "./documentTokenStore.ts";

describe("DocumentTokenStore caching", () => {
    it("returns undefined for lines that have not been tokenized yet", () => {
        const doc = new TextDocument("a\nb\nc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        expect(store.getLineTokens(0)).toBeUndefined();
        expect(store.getLineTokens(2)).toBeUndefined();
    });

    it("forceTokenization populates the cache for [0..targetLine]", () => {
        const doc = new TextDocument("a\nb\nc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(1);
        expect(store.getLineTokens(0)).toBeDefined();
        expect(store.getLineTokens(1)).toBeDefined();
        expect(store.getLineTokens(2)).toBeUndefined();
    });

    it("does not call the tokenizer twice for the same line", () => {
        const doc = new TextDocument("hello\nworld");
        const tokenizer = new PlainTextTokenizer();
        const spy = vi.spyOn(tokenizer, "tokenizeEncoded");
        const store = new DocumentTokenStore(doc, tokenizer);
        store.forceTokenization(1);
        const callsAfterFirst = spy.mock.calls.length;
        store.forceTokenization(1);
        expect(spy.mock.calls.length).toBe(callsAfterFirst);
    });

    it("setLineTokens overrides cached tokens", () => {
        const doc = new TextDocument("a\nb");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(0);
        store.setLineTokens(0, storedTokens([[0, markedMetadata(42)]], 1));
        expect(store.getLineTokens(0)?.getForeground(0)).toBe(42);
    });

    it("getLineTokens returns undefined for out-of-range indices", () => {
        const doc = new TextDocument("a");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(0);
        expect(store.getLineTokens(-1)).toBeUndefined();
        expect(store.getLineTokens(1)).toBeUndefined();
    });
});
