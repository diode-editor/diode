import { describe, expect, it } from "vitest";

import { EndOfLine } from "../core/endOfLine.ts";

import { TextDocument } from "./textDocument.ts";

describe("TextDocument EOL model", () => {
    // ─── Detection on load ──────────────────────────────────

    it("defaults to LF for empty / single-line text", () => {
        expect(new TextDocument("").eol).toBe(EndOfLine.LF);
        expect(new TextDocument("hello").eol).toBe(EndOfLine.LF);
    });

    it("detects LF from LF-separated text", () => {
        expect(new TextDocument("a\nb\nc").eol).toBe(EndOfLine.LF);
    });

    it("detects CRLF from CRLF-separated text", () => {
        expect(new TextDocument("a\r\nb\r\nc").eol).toBe(EndOfLine.CRLF);
    });

    it("detects the prevailing sequence from mixed text", () => {
        expect(new TextDocument("a\r\nb\r\nc\nd").eol).toBe(EndOfLine.CRLF);
        expect(new TextDocument("a\r\nb\nc\nd").eol).toBe(EndOfLine.LF);
    });

    // ─── LF-canonical internal storage ──────────────────────

    it("strips \\r from line content when loading CRLF text", () => {
        const doc = new TextDocument("a\r\nb\r\nc");
        expect(doc.lineCount).toBe(3);
        expect(doc.getLineContent(0)).toBe("a");
        expect(doc.getLineContent(1)).toBe("b");
        expect(doc.getLineContent(2)).toBe("c");
    });

    it("getText() always returns LF regardless of eol", () => {
        expect(new TextDocument("a\r\nb\r\nc").getText()).toBe("a\nb\nc");
        expect(new TextDocument("a\nb\nc").getText()).toBe("a\nb\nc");
    });

    it("getLineLength() excludes the stripped \\r", () => {
        const doc = new TextDocument("ab\r\ncdef");
        expect(doc.getLineLength(0)).toBe(2);
        expect(doc.getLineLength(1)).toBe(4);
    });

    // ─── serialize() ────────────────────────────────────────

    it("serialize() joins with the document's eol", () => {
        expect(new TextDocument("a\r\nb\r\nc").serialize()).toBe("a\r\nb\r\nc");
        expect(new TextDocument("a\nb\nc").serialize()).toBe("a\nb\nc");
    });

    it("round-trips a CRLF document byte-for-byte", () => {
        const original = "line1\r\nline2\r\nline3\r\n";
        const doc = new TextDocument(original);
        expect(doc.serialize()).toBe(original);
    });

    it("round-trips an LF document byte-for-byte", () => {
        const original = "line1\nline2\nline3\n";
        const doc = new TextDocument(original);
        expect(doc.serialize()).toBe(original);
    });

    // ─── setEol() ───────────────────────────────────────────

    it("setEol changes eol and serialize output but not getText or version", () => {
        const doc = new TextDocument("a\nb");
        const versionBefore = doc.versionId;

        doc.setEol(EndOfLine.CRLF);

        expect(doc.eol).toBe(EndOfLine.CRLF);
        expect(doc.getText()).toBe("a\nb");
        expect(doc.serialize()).toBe("a\r\nb");
        expect(doc.versionId).toBe(versionBefore);
    });

    it("setEol back to LF restores LF serialization", () => {
        const doc = new TextDocument("a\r\nb");
        doc.setEol(EndOfLine.LF);
        expect(doc.serialize()).toBe("a\nb");
    });

    // ─── onDidChangeEol ─────────────────────────────────────

    it("onDidChangeEol fires when setEol changes the sequence", () => {
        const doc = new TextDocument("a\nb");
        let fired = 0;
        doc.onDidChangeEol(() => fired++);

        doc.setEol(EndOfLine.CRLF);

        expect(fired).toBe(1);
    });

    it("onDidChangeEol does not fire when setEol is a no-op", () => {
        const doc = new TextDocument("a\nb");
        let fired = 0;
        doc.onDidChangeEol(() => fired++);

        doc.setEol(EndOfLine.LF);

        expect(fired).toBe(0);
    });

    it("dispose подписки onDidChangeEol останавливает доставку, повторный dispose — no-op", () => {
        const doc = new TextDocument("a\nb");
        let fired = 0;
        const subscription = doc.onDidChangeEol(() => fired++);
        const other = doc.onDidChangeEol(() => undefined);

        subscription.dispose();
        subscription.dispose();
        doc.setEol(EndOfLine.CRLF);

        expect(fired).toBe(0);
        other.dispose();
    });

    // ─── setText re-detects eol ─────────────────────────────

    it("setText объявляет смену EOL ровно тогда, когда он сменился", () => {
        const doc = new TextDocument("a\nb");
        let fired = 0;
        doc.onDidChangeEol(() => fired++);

        doc.setText("c\nd");
        expect(fired).toBe(0);

        doc.setText("x\r\ny");
        expect(fired).toBe(1);
    });

    it("setText re-detects eol and strips \\r", () => {
        const doc = new TextDocument("a\nb");
        doc.setText("x\r\ny\r\nz");
        expect(doc.eol).toBe(EndOfLine.CRLF);
        expect(doc.getText()).toBe("x\ny\nz");
        expect(doc.serialize()).toBe("x\r\ny\r\nz");
    });
});
