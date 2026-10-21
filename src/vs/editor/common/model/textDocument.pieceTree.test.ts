import { describe, expect, it } from "vitest";

import { EndOfLine } from "../core/endOfLine.ts";
import { createRange } from "../core/iRange.ts";
import { createInsertEdit, createTextEdit } from "../core/iTextEdit.ts";

import type { IDocumentContentChange, IModelContentChangedEvent } from "./iDocumentContentChange.ts";
import { TextDocument } from "./textDocument.ts";

function collect(doc: TextDocument): { changes: IDocumentContentChange[]; batches: IModelContentChangedEvent[] } {
    const changes: IDocumentContentChange[] = [];
    const batches: IModelContentChangedEvent[] = [];
    doc.onDidChangeContent((change) => changes.push(change));
    doc.onDidChangeModelContent((event) => batches.push(event));
    return { changes, batches };
}

describe("TextDocument поверх PieceTree — EOL при загрузке", () => {
    it("одиночный \\r — перевод строки, как в эталоне", () => {
        const doc = new TextDocument("a\rb\nc");
        expect(doc.lineCount).toBe(3);
        expect(doc.getLineContent(0)).toBe("a");
        expect(doc.getLineContent(1)).toBe("b");
        expect(doc.getText()).toBe("a\nb\nc");
    });

    it("смешанные EOL приводятся к преобладающему — и в serialize", () => {
        const doc = new TextDocument("a\r\nb\r\nc\nd");
        expect(doc.eol).toBe(EndOfLine.CRLF);
        expect(doc.serialize()).toBe("a\r\nb\r\nc\r\nd");
        expect(doc.getText()).toBe("a\nb\nc\nd");
    });

    it("ведущий U+FEFF остаётся символом текста", () => {
        const doc = new TextDocument("﻿ab\ncd");
        expect(doc.getLineContent(0)).toBe("﻿ab");
        expect(doc.getText()).toBe("﻿ab\ncd");
        expect(doc.serialize()).toBe("﻿ab\ncd");
    });

    it("пустой документ — одна пустая строка", () => {
        const doc = new TextDocument("");
        expect(doc.lineCount).toBe(1);
        expect(doc.getLineLength(0)).toBe(0);
        expect(doc.getText()).toBe("");
        expect(doc.serialize()).toBe("");
    });

    it("setEol переписывает переводы строк буфера, а строки и getText не трогает", () => {
        const doc = new TextDocument("a\nb\nc");
        doc.setEol(EndOfLine.CRLF);
        expect(doc.serialize()).toBe("a\r\nb\r\nc");
        expect(doc.getText()).toBe("a\nb\nc");
        expect(doc.getLineLength(0)).toBe(1);
        expect(doc.versionId).toBe(0);
    });
});

describe("TextDocument поверх PieceTree — правки", () => {
    it("\\r\\n и \\r во вставке — переводы строк: события, батч и текст согласованы", () => {
        const doc = new TextDocument("ab");
        const { changes, batches } = collect(doc);

        doc.applyEdits([createInsertEdit(0, 1, "x\r\ny\rz")]);

        expect(doc.getText()).toBe("ax\ny\nzb");
        expect(doc.lineCount).toBe(3);
        expect(changes).toEqual([{ startLine: 0, oldEndLine: 0, newEndLine: 2 }]);
        expect(batches[0].changes).toEqual([{ range: createRange(0, 1, 0, 1), text: "x\ny\nz" }]);
    });

    it("в CRLF-документе вставка с \\n сохраняется с EOL документа, обратная правка — с \\n", () => {
        const doc = new TextDocument("a\r\nb");
        const { inverseEdits } = doc.applyEdits([createTextEdit(createRange(0, 1, 1, 0), "\nX\n")]);

        expect(doc.serialize()).toBe("a\r\nX\r\nb");
        expect(inverseEdits).toEqual([createTextEdit(createRange(0, 1, 2, 0), "\n")]);
    });

    it("края правки за концом строки и документа приводятся к документу", () => {
        const doc = new TextDocument("abc\nde");
        const { changes, batches } = collect(doc);

        const { inverseEdits } = doc.applyEdits([createTextEdit(createRange(0, 10, 5, 7), "!")]);

        expect(doc.getText()).toBe("abc!");
        expect(changes).toEqual([{ startLine: 0, oldEndLine: 1, newEndLine: 0 }]);
        expect(batches[0].changes).toEqual([{ range: createRange(0, 3, 1, 2), text: "!" }]);
        expect(inverseEdits).toEqual([createTextEdit(createRange(0, 3, 0, 4), "\nde")]);
    });

    it("getTextInRange приводит края к документу", () => {
        const doc = new TextDocument("abc\nde");
        expect(doc.getTextInRange(createRange(0, 2, 9, 9))).toBe("c\nde");
        expect(doc.getTextInRange(createRange(0, 10, 0, 12))).toBe("");
    });

    it("пересекающиеся правки — отказ до любых изменений", () => {
        const doc = new TextDocument("abcdef");
        const id = doc.deltaDecorations([], [{ range: createRange(0, 4, 0, 5), options: { description: "t" } }])[0];
        const { changes } = collect(doc);

        expect(() =>
            doc.applyEdits([
                createTextEdit(createRange(0, 0, 0, 3), "X"),
                createTextEdit(createRange(0, 2, 0, 4), "Y"),
            ]),
        ).toThrow("Overlapping ranges are not allowed!");

        expect(doc.getText()).toBe("abcdef");
        expect(doc.versionId).toBe(0);
        expect(changes).toEqual([]);
        expect(doc.getDecorationRange(id)).toEqual(createRange(0, 4, 0, 5));
    });

    it("стык правок — не пересечение", () => {
        const doc = new TextDocument("abcdef");
        doc.applyEdits([createTextEdit(createRange(0, 0, 0, 2), "X"), createTextEdit(createRange(0, 2, 0, 4), "Y")]);
        expect(doc.getText()).toBe("XYef");
    });

    it("батч от 1000 правок не схлопывается: событие и обратная правка на каждую", () => {
        const count = 1200;
        const lines = Array.from({ length: count }, (_, i) => `l${i.toString()}`);
        const doc = new TextDocument(lines.join("\n"));
        const { changes, batches } = collect(doc);

        const { inverseEdits } = doc.applyEdits(lines.map((_, i) => createInsertEdit(i, 0, ">")));

        expect(changes).toHaveLength(count);
        expect(batches[0].changes).toHaveLength(count);
        expect(inverseEdits).toHaveLength(count);
        expect(inverseEdits[count - 1]).toEqual(createTextEdit(createRange(count - 1, 0, count - 1, 1), ""));
        expect(doc.getLineContent(count - 1)).toBe(`>l${(count - 1).toString()}`);
    });

    it("декорация в многострочной правке меряется по тексту до батча, даже когда ниже есть правки", () => {
        const doc = new TextDocument("aaaa\nbbbb\ncccc");
        const id = doc.deltaDecorations([], [{ range: createRange(1, 2, 1, 2), options: { description: "t" } }])[0];

        doc.applyEdits([createTextEdit(createRange(0, 2, 2, 1), "XYZ12345"), createInsertEdit(2, 3, "!")]);

        // Edge offset from the edit start: 2 ("aa") + 1 ("\n") + 2 ("bb") = 5 → "XYZ12|345".
        expect(doc.getText()).toBe("aaXYZ12345cc!c");
        expect(doc.getDecorationRange(id)).toEqual(createRange(0, 7, 0, 7));
    });

    it("setText заменяет буфер: строки, EOL и версия — нового текста", () => {
        const doc = new TextDocument("a\nb");
        doc.setText("x\r\ny\r\nz");
        expect(doc.lineCount).toBe(3);
        expect(doc.eol).toBe(EndOfLine.CRLF);
        expect(doc.getLineContent(2)).toBe("z");
        expect(doc.versionId).toBe(1);
    });

    it("строка за пределами документа — RangeError с границами", () => {
        const doc = new TextDocument("a\nb");
        expect(() => doc.getLineContent(2)).toThrow("Line index 2 out of bounds [0, 1]");
        expect(() => doc.getLineLength(-1)).toThrow(RangeError);
    });
});
