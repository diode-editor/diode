import { describe, expect, it } from "vitest";

import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";
import { PlainTextTokenizer } from "../languages/builtin/plainTextTokenizer.ts";
import { TextDocument } from "../model/textDocument.ts";

import { DocumentTokenStore } from "./documentTokenStore.ts";

const MARKER = { tokens: [{ startIndex: 0, scopes: ["marker"] }] };

describe("DocumentTokenStore shifting", () => {
    it("shifts cached tokens down when lines are inserted above", () => {
        const doc = new TextDocument("a\nb\nc");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(2);
        store.setLineTokens(2, MARKER);

        // Insert two new lines at the very top.
        doc.applyEdits([createInsertEdit(0, 0, "X\nY\n")]);

        // Marker which was on line 2 should now be on line 4 (or stay on 2 — semantics:
        // the inserted block is BEFORE startLine, so cached entries shift down by 2).
        expect(store.getLineTokens(4)).toBe(MARKER);
    });

    it("shifts cached tokens up when lines are deleted above", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const store = new DocumentTokenStore(doc, new PlainTextTokenizer());
        store.forceTokenization(4);
        store.setLineTokens(4, MARKER);

        // Delete lines 0 and 1 (i.e. delete from (0,0) to (2,0)).
        doc.applyEdits([createDeleteEdit(0, 0, 2, 0)]);

        // After delete: c,d,e — marker which was on line 4 must be on line 2.
        expect(store.getLineTokens(2)).toBe(MARKER);
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
        // Asking for a logical line beyond the new EOF returns undefined.
        expect(store.getLineTokens(doc.lineCount)).toBeUndefined();
    });
});
