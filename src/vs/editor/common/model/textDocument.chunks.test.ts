/**
 * Текст мимо одной большой строки (A4, docs/TODO/VscodeModel.md): документ
 * собирается из кусков чтения файла и пишется на диск снимком по кускам.
 */
import { describe, expect, it } from "vitest";

import { EndOfLine } from "../core/endOfLine.ts";
import { createRange } from "../core/iRange.ts";
import { createInsertEdit, createTextEdit } from "../core/iTextEdit.ts";

import { createTextBufferFactoryFromChunks, TextDocument } from "./textDocument.ts";

/** Все разрезы текста на два куска плюс посимвольный (по кодовым единицам). */
function splits(text: string): string[][] {
    const result: string[][] = [text.split("")];
    for (let at = 0; at <= text.length; at++) result.push([text.slice(0, at), text.slice(at)]);
    return result;
}

function documentFacts(doc: TextDocument): unknown {
    const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.getLineContent(i));
    return { lines, eol: doc.eol, text: doc.getText(), serialized: doc.serialize() };
}

describe("TextDocument из кусков", () => {
    const SAMPLES = ["", "a\r\nb\r\nc", "a\r\nb\nc\r\n", "x\ry\r", "😀\r\n𝄞\n", "\ufeffbom\r\nline", "\r\n\r\n"];

    for (const sample of SAMPLES) {
        it(`${JSON.stringify(sample)}: любой разрез (посреди \\r\\n, суррогатной пары) == документу из строки`, () => {
            const expected = documentFacts(new TextDocument(sample));
            for (const chunks of splits(sample)) {
                const doc = new TextDocument(createTextBufferFactoryFromChunks(chunks));
                expect(documentFacts(doc), JSON.stringify(chunks)).toEqual(expected);
            }
        });
    }

    it("setText фабрикой — тот же flush, что строкой", () => {
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

    it("== serialize: CRLF-документ после правок с \\n, ведущий U+FEFF, setEol", () => {
        const doc = new TextDocument("\ufeffa\r\nb\r\nc");
        doc.applyEdits([createInsertEdit(1, 1, "X\nY")]);
        doc.applyEdits([createTextEdit(createRange(0, 1, 0, 2), "😀")]);
        expect(join(doc)).toBe(doc.serialize());
        expect(join(doc)).toBe("\ufeff😀\r\nbX\r\nY\r\nc");
        doc.setEol(EndOfLine.LF);
        expect(join(doc)).toBe(doc.serialize());
    });

    it("пустой документ — пустой снимок", () => {
        expect(join(new TextDocument(""))).toBe("");
    });

    it("мелкие куски правок склеиваются до ~64 КБ, крупный текст режется не мельче", () => {
        const doc = new TextDocument(
            createTextBufferFactoryFromChunks(Array.from({ length: 3 }, () => "x".repeat(50_000))),
        );
        for (let i = 0; i < 2000; i++) doc.applyEdits([createInsertEdit(0, i * 2, "y")]);
        const chunks = [...doc.createSnapshot()];
        expect(chunks.join("")).toBe(doc.serialize());
        // Все, кроме последнего, — не меньше порога: тысячи однобуквенных кусков
        // правок не доходят до кодировщика по одному.
        for (const chunk of chunks.slice(0, -1)) expect(chunk.length).toBeGreaterThanOrEqual(64 * 1024);
        expect(chunks.length).toBeGreaterThanOrEqual(2);
        expect(chunks.length).toBeLessThanOrEqual(3);
    });

    it("кусок, дошедший до порога, уходит сразу; пустого хвоста в конце нет", () => {
        const piece = 64 * 1024;
        const doc = new TextDocument(createTextBufferFactoryFromChunks(["x".repeat(piece), "y".repeat(piece)]));
        expect([...doc.createSnapshot()].map((chunk) => chunk.length)).toEqual([piece, piece]);
    });

    it("снимок фиксирует текст на момент вызова", () => {
        const doc = new TextDocument("before");
        const snapshot = doc.createSnapshot();
        doc.applyEdits([createInsertEdit(0, 0, "edited ")]);
        expect([...snapshot].join("")).toBe("before");
    });
});

describe("TextDocument.getLinesContent", () => {
    it("строки без переводов строк, CRLF и одиночный \\r — разделители", () => {
        const doc = new TextDocument("a\r\nb\r\n\r\nc\rd");
        expect(doc.getLinesContent()).toEqual(["a", "b", "", "c", "d"]);
        expect(new TextDocument("").getLinesContent()).toEqual([""]);
    });
});
