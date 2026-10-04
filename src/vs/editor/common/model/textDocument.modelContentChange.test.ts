import { describe, expect, it } from "vitest";

import { EndOfLine } from "../core/endOfLine.ts";
import { createRange } from "../core/iRange.ts";
import { createDeleteEdit, createInsertEdit, createTextEdit, type ITextEdit } from "../core/iTextEdit.ts";

import type { IModelContentChange, IModelContentChangedEvent } from "./iDocumentContentChange.ts";
import { TextDocument } from "./textDocument.ts";

function record(doc: TextDocument): IModelContentChangedEvent[] {
    const events: IModelContentChangedEvent[] = [];
    doc.onDidChangeModelContent((e) => events.push(e));
    return events;
}

/** Зеркало: применяет правки батча по одной к строкам ДО батча — как это сделает субпроцесс. */
function mirror(text: string, changes: readonly IModelContentChange[]): string {
    let lines = text.split("\n");
    for (const { range, text: inserted } of changes) {
        const prefix = lines[range.start.line].substring(0, range.start.character);
        const suffix = lines[range.end.line].substring(range.end.character);
        const middle = (prefix + inserted + suffix).split("\n");
        lines = [...lines.slice(0, range.start.line), ...middle, ...lines.slice(range.end.line + 1)];
    }
    return lines.join("\n");
}

/** Применяет батч и проверяет главное свойство: зеркало сходится с документом. */
function applyAndMirror(initial: string, edits: readonly ITextEdit[]): IModelContentChangedEvent {
    const doc = new TextDocument(initial);
    const events = record(doc);
    doc.applyEdits(edits);
    expect(events).toHaveLength(1);
    expect(mirror(initial, events[0].changes)).toBe(doc.getText());
    return events[0];
}

describe("TextDocument.onDidChangeModelContent — батч точных правок", () => {
    it("одна вставка: правка как есть, версия после батча, EOL документа", () => {
        const doc = new TextDocument("hello\r\nworld");
        const events = record(doc);
        doc.applyEdits([createInsertEdit(0, 5, "!")]);
        expect(events).toEqual([
            {
                changes: [{ range: createRange(0, 5, 0, 5), text: "!" }],
                versionId: 1,
                eol: EndOfLine.CRLF,
                isFlush: false,
            },
        ]);
    });

    it("мультикурсор на одной строке: правки снизу вверх, в исходных координатах", () => {
        const event = applyAndMirror("abc", [createInsertEdit(0, 0, "x"), createInsertEdit(0, 2, "y")]);
        expect(event.changes).toEqual([
            { range: createRange(0, 2, 0, 2), text: "y" },
            { range: createRange(0, 0, 0, 0), text: "x" },
        ]);
    });

    it("совпадающие диапазоны: две вставки в одну точку склеиваются в порядке батча", () => {
        const event = applyAndMirror("ab", [createInsertEdit(0, 1, "1"), createInsertEdit(0, 1, "2")]);
        expect(mirror("ab", event.changes)).toBe("a12b");
    });

    it("вставка с переводами строк и удаление со склейкой строк", () => {
        applyAndMirror("a\nb\nc", [createInsertEdit(0, 1, "X\nY\n"), createDeleteEdit(1, 1, 2, 0)]);
        applyAndMirror("one\ntwo\nthree", [createDeleteEdit(0, 3, 2, 0)]);
    });

    it("замена на конце документа и удаление последней строки", () => {
        applyAndMirror("a\nb", [createTextEdit(createRange(1, 0, 1, 1), "end")]);
        applyAndMirror("a\nb", [createDeleteEdit(0, 1, 1, 1)]);
        applyAndMirror("", [createInsertEdit(0, 0, "\n\n")]);
    });

    it("батч — после построчных событий того же applyEdits", () => {
        const doc = new TextDocument("a\nb");
        const order: string[] = [];
        doc.onDidChangeContent(() => order.push("line"));
        doc.onDidChangeModelContent(() => order.push("batch"));
        doc.applyEdits([createInsertEdit(0, 0, "x"), createInsertEdit(1, 0, "y")]);
        expect(order).toEqual(["line", "line", "batch"]);
    });

    it("пустой батч ничего не шлёт", () => {
        const doc = new TextDocument("a");
        const events = record(doc);
        doc.applyEdits([]);
        expect(events).toEqual([]);
    });

    it("setText — flush без правок, с новой версией и пере-детектом EOL", () => {
        const doc = new TextDocument("a\nb");
        const events = record(doc);
        doc.setText("x\r\ny");
        expect(events).toEqual([{ changes: [], versionId: 1, eol: EndOfLine.CRLF, isFlush: true }]);
    });

    it("свойство: зеркало сходится с документом на случайных батчах", () => {
        // Детерминированный ГПСЧ (mulberry32): падение воспроизводимо.
        let seed = 0x2f6b;
        const random = (): number => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const pick = (n: number): number => Math.floor(random() * n);
        const pieces = ["", "x", "yz", "\n", "a\nb", "\n\n", "é"];
        for (let round = 0; round < 300; round++) {
            const doc = new TextDocument(["ab", "", "cde", "f"].slice(0, 1 + pick(4)).join("\n"));
            const before = doc.getText();
            const events = record(doc);
            // Непересекающиеся правки: по одной на случайную строку, в порядке строк.
            const edits: ITextEdit[] = [];
            for (let line = 0; line < doc.lineCount; line++) {
                if (random() < 0.5) continue;
                const length = doc.getLineLength(line);
                const start = pick(length + 1);
                const end = start + pick(length - start + 1);
                edits.push(createTextEdit(createRange(line, start, line, end), pieces[pick(pieces.length)]));
            }
            doc.applyEdits(edits);
            if (edits.length === 0) continue;
            expect(mirror(before, events[0].changes), `раунд ${String(round)}`).toBe(doc.getText());
        }
    });
});
