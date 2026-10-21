import { describe, expect, it } from "vitest";

import { markedMetadata, storedTokens } from "../../../../TestUtils/encodedTokens.ts";
import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";
import { PlainTextTokenizer } from "../languages/builtin/plainTextTokenizer.ts";
import { TextDocument } from "../model/textDocument.ts";

import { DocumentTokenStore } from "./documentTokenStore.ts";

/** The mark is the token color; lines in the tests have length 1. */
const MARK = 42;
const marker = (): Uint32Array => storedTokens([[0, markedMetadata(MARK)]], 1);

describe("DocumentTokenStore shifting", () => {
    it("shifts cached tokens down when lines are inserted above", () => {
        const doc = new TextDocument("a\nb\nc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(2);
        store.setLineTokens(2, marker());

        doc.applyEdits([createInsertEdit(0, 0, "X\nY\n")]);

        expect(store.getLineTokens(4)?.getForeground(0)).toBe(MARK);
    });

    it("shifts cached tokens up when lines are deleted above", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(4);
        store.setLineTokens(4, marker());

        doc.applyEdits([createDeleteEdit(0, 0, 2, 0)]);

        expect(store.getLineTokens(2)?.getForeground(0)).toBe(MARK);
    });

    it("array length matches document.lineCount after insert", () => {
        const doc = new TextDocument("a\nb");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(1);

        doc.applyEdits([createInsertEdit(1, 0, "X\nY\n")]);
        store.forceTokenization(doc.lineCount - 1);

        for (let i = 0; i < doc.lineCount; i++) {
            expect(store.getLineTokens(i)).toBeDefined();
        }
    });

    it("array length matches document.lineCount after delete", () => {
        const doc = new TextDocument("a\nb\nc\nd");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(3);

        doc.applyEdits([createDeleteEdit(1, 0, 3, 0)]);
        store.forceTokenization(doc.lineCount - 1);

        for (let i = 0; i < doc.lineCount; i++) {
            expect(store.getLineTokens(i)).toBeDefined();
        }
        expect(store.getLineTokens(doc.lineCount)).toBeUndefined();
    });
});
