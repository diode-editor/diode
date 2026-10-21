import { describe, expect, it } from "vitest";

import { EndOfLine } from "../core/endOfLine.ts";
import { createRange } from "../core/iRange.ts";
import { createInsertEdit, createTextEdit } from "../core/iTextEdit.ts";

import { createTextBufferFactoryFromChunks, TextDocument } from "./textDocument.ts";

function splits(text: string): string[][] {
    const result: string[][] = [text.split("")];
    for (let at = 0; at <= text.length; at++) result.push([text.slice(0, at), text.slice(at)]);
    return result;
}

function documentFacts(doc: TextDocument): unknown {
    const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.getLineContent(i));
    return { lines, eol: doc.eol, text: doc.getText(), serialized: doc.serialize() };
}

describe("TextDocument from chunks", () => {
    const SAMPLES = ["", "a\r\nb\r\nc", "a\r\nb\nc\r\n", "x\ry\r", "😀\r\n𝄞\n", "\ufeffbom\r\nline", "\r\n\r\n"];

    for (const sample of SAMPLES) {
        it(`${JSON.stringify(sample)}: any split (inside \\r\\n, a surrogate pair) == document from string`, () => {
            const expected = documentFacts(new TextDocument(sample));
            for (const chunks of splits(sample)) {
                const doc = new TextDocument(createTextBufferFactoryFromChunks(chunks));
                expect(documentFacts(doc), JSON.stringify(chunks)).toEqual(expected);
            }
        });
    }

    it("setText with a factory is the same flush as with a string", () => {
        const doc = new TextDocument("old");
        const flushes: boolean[] = [];
        doc.onDidChangeModelContent((event) => flushes.push(event.isFlush));
        doc.setText(createTextBufferFactoryFromChunks(["new\r", "\nline"]));
        expect(flushes).toEqual([true]);
        expect(doc.versionId).toBe(1);
        expect(doc.eol).toBe(EndOfLine.CRLF);
        expect(doc.getText()).toBe("new\nline");
    });
});

describe("TextDocument.createSnapshot", () => {
    const join = (doc: TextDocument): string => [...doc.createSnapshot()].join("");

    it("== serialize: CRLF document after edits with \\n, leading U+FEFF, setEol", () => {
        const doc = new TextDocument("\ufeffa\r\nb\r\nc");
        doc.applyEdits([createInsertEdit(1, 1, "X\nY")]);
        doc.applyEdits([createTextEdit(createRange(0, 1, 0, 2), "😀")]);
        expect(join(doc)).toBe(doc.serialize());
        expect(join(doc)).toBe("\ufeff😀\r\nbX\r\nY\r\nc");
        doc.setEol(EndOfLine.LF);
        expect(join(doc)).toBe(doc.serialize());
    });

    it("empty document gives an empty snapshot", () => {
        expect(join(new TextDocument(""))).toBe("");
    });

    it("small edit chunks join up to ~64 KB, large text is not split finer", () => {
        const doc = new TextDocument(
            createTextBufferFactoryFromChunks(Array.from({ length: 3 }, () => "x".repeat(50_000))),
        );
        for (let i = 0; i < 2000; i++) doc.applyEdits([createInsertEdit(0, i * 2, "y")]);
        const chunks = [...doc.createSnapshot()];
        expect(chunks.join("")).toBe(doc.serialize());
        for (const chunk of chunks.slice(0, -1)) expect(chunk.length).toBeGreaterThanOrEqual(64 * 1024);
        expect(chunks.length).toBeGreaterThanOrEqual(2);
        expect(chunks.length).toBeLessThanOrEqual(3);
    });

    it("chunk reaching the threshold is emitted at once; no empty tail at the end", () => {
        const piece = 64 * 1024;
        const doc = new TextDocument(createTextBufferFactoryFromChunks(["x".repeat(piece), "y".repeat(piece)]));
        expect([...doc.createSnapshot()].map((chunk) => chunk.length)).toEqual([piece, piece]);
    });

    it("snapshot captures the text at call time", () => {
        const doc = new TextDocument("before");
        const snapshot = doc.createSnapshot();
        doc.applyEdits([createInsertEdit(0, 0, "edited ")]);
        expect([...snapshot].join("")).toBe("before");
    });
});

describe("TextDocument.getLinesContent", () => {
    it("lines without line breaks, CRLF and lone \\r are separators", () => {
        const doc = new TextDocument("a\r\nb\r\n\r\nc\rd");
        expect(doc.getLinesContent()).toEqual(["a", "b", "", "c", "d"]);
        expect(new TextDocument("").getLinesContent()).toEqual([""]);
    });
});
