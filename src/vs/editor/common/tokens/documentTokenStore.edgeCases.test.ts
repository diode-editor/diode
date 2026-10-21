import { describe, expect, it } from "vitest";

import { markedMetadata, storedTokens } from "../../../../TestUtils/encodedTokens.ts";
import { setUnexpectedErrorHandler } from "../../../base/common/errors.ts";
import { createDeleteEdit } from "../core/iTextEdit.ts";
import { ColorId, StandardTokenType } from "../encodedTokenAttributes.ts";
import type { ITokenizationSupport } from "../languages.ts";
import { PlainTextTokenizer } from "../languages/builtin/plainTextTokenizer.ts";
import { NULL_STATE } from "../languages/iState.ts";
import { TextDocument } from "../model/textDocument.ts";

import { DocumentTokenStore } from "./documentTokenStore.ts";

describe("DocumentTokenStore.getEndState", () => {
    it("returns the cached end state of a tokenized line", () => {
        const doc = new TextDocument("a\nb\nc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());

        expect(store.getEndState(0)).toBeUndefined();

        store.forceTokenization(2);

        const s0 = store.getEndState(0);
        expect(s0).toBeDefined();
        expect(s0!.equals(s0!)).toBe(true);
        expect(store.getEndState(2)).toBeDefined();
    });
});

describe("DocumentTokenStore.handleContentChange: accuracy after a delete", () => {
    it("multiline delete: lines above are exact, the edit itself and below are not", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(4);
        expect(store.hasAccurateTokensForLine(4)).toBe(true);

        doc.applyEdits([createDeleteEdit(2, 0, 4, 0)]);
        expect(store.hasAccurateTokensForLine(1)).toBe(true);
        expect(store.hasAccurateTokensForLine(2)).toBe(false);

        store.forceTokenization(doc.lineCount - 1);
        expect(store.hasAccurateTokensForLine(doc.lineCount - 1)).toBe(true);
        expect(store.getLineTokens(2)).toBeDefined();
    });

    it("edit collapsing the tail onto line 0 leaves it inexact until recompute", () => {
        const doc = new TextDocument("a\nb\nc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(2);

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
        const custom = storedTokens([[0, markedMetadata(42)]], 1);

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

        store.forceTokenization(1);
        expect(store.hasAccurateTokensForLine(1)).toBe(true);
        expect(store.hasAccurateTokensForLine(2)).toBe(false);
        expect(store.getLineTokens(3)).toBeUndefined();

        store.forceTokenization(3);
        expect(store.getLineTokens(2)).toBeDefined();
        expect(store.getLineTokens(3)).toBeDefined();
        expect(store.hasAccurateTokensForLine(3)).toBe(true);
        expect(store.hasAccurateTokensForLine(4)).toBe(false);
    });
});

describe("DocumentTokenStore: language codec", () => {
    it("token language is the document language (languages are not encoded in metadata)", () => {
        const doc = new TextDocument("abc", "typescript");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(0);
        expect(store.getLineTokens(0)?.getLanguageId(0)).toBe("typescript");
    });

    it("tokenizer threw: the line gets the default token (upstream nullTokenizeEncoded), the error goes to onUnexpectedError", () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        const failing: ITokenizationSupport = {
            getInitialState: () => NULL_STATE,
            tokenizeEncoded: () => {
                throw new Error("boom");
            },
        };
        const store = new DocumentTokenStore(new TextDocument("abc"), failing);
        store.forceTokenization(0);

        const tokens = store.getLineTokens(0);
        expect(tokens?.getCount()).toBe(1);
        expect(tokens?.getForeground(0)).toBe(ColorId.DefaultForeground);
        expect(tokens?.getStandardTokenType(0)).toBe(StandardTokenType.Other);
        expect(errors).toHaveLength(1);
    });
});
