import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { createTextEdit } from "../core/iTextEdit.ts";

import { TextDocument } from "./textDocument.ts";

// Формы батчей, на которых ломался round-trip обратных правок (единственный пейлоад undo).

function roundTrip(text: string, edits: readonly ITextEdit[]): { after: string; undone: string } {
    const doc = new TextDocument(text);
    const { inverseEdits } = doc.applyEdits(edits);
    const after = doc.getText();
    doc.applyEdits(inverseEdits);
    return { after, undone: doc.getText() };
}

describe("TextDocument.applyEdits — обратные правки батча", () => {
    it("возвращает импорт на место после quick fix «удалить неиспользуемый assert»", () => {
        // Снято с живого typescript-language-server: обратные правки — две
        // вставки нулевой ширины В ОДНУ ТОЧКУ (0,13), порядок решает всё.
        const line = 'import { test, assert } from "./test.js";';
        const { after, undone } = roundTrip(line, [
            createTextEdit(createRange(0, 13, 0, 15), ""),
            createTextEdit(createRange(0, 15, 0, 21), ""),
        ]);

        expect(after).toBe('import { test } from "./test.js";');
        expect(undone).toBe(line);
    });

    it("не переставляет местами вставки, попавшие в одну точку", () => {
        // Перепутанный порядок дал бы "cdab" той же длины — ассерт смотрит на содержимое.
        const { after, undone } = roundTrip("abcdXY", [
            createTextEdit(createRange(0, 0, 0, 2), ""),
            createTextEdit(createRange(0, 2, 0, 4), ""),
        ]);

        expect(after).toBe("XY");
        expect(undone).toBe("abcdXY");
    });

    it("учитывает склейку строк: правка на строке, приклеенной предыдущей правкой", () => {
        // Вторая правка едет и по строке, И по колонке — сдвиг только по строке промахнулся бы.
        const text = "ab\ncdef\n";
        const { after, undone } = roundTrip(text, [
            createTextEdit(createRange(0, 1, 1, 1), ""),
            createTextEdit(createRange(1, 1, 1, 3), ""),
        ]);

        expect(after).toBe("af\n");
        expect(undone).toBe(text);
    });

    it("учитывает склейку строк, когда правка вставляет непустой текст", () => {
        const text = "ab\ncdef\n";
        const { after, undone } = roundTrip(text, [
            createTextEdit(createRange(0, 1, 1, 1), "X\nYZ"),
            createTextEdit(createRange(1, 1, 1, 3), "Q"),
        ]);

        expect(after).toBe("aX\nYZQf\n");
        expect(undone).toBe(text);
    });

    it("сдвигает правку на следующих строках на накопленную разницу строк", () => {
        const text = "aaa\nbbb\nccc\nddd\n";
        const { after, undone } = roundTrip(text, [
            createTextEdit(createRange(0, 0, 1, 0), ""),
            createTextEdit(createRange(2, 1, 2, 2), "X"),
        ]);

        expect(after).toBe("bbb\ncXc\nddd\n");
        expect(undone).toBe(text);
    });

    it("сдвигает правку на следующих строках вниз, когда батч добавил строки", () => {
        const text = "aaa\nbbb\nccc\n";
        const { after, undone } = roundTrip(text, [
            createTextEdit(createRange(0, 1, 0, 2), "1\n2\n3"),
            createTextEdit(createRange(2, 1, 2, 2), "X"),
        ]);

        expect(after).toBe("a1\n2\n3a\nbbb\ncXc\n");
        expect(undone).toBe(text);
    });

    it("round-trip не зависит от порядка правок в батче", () => {
        const text = "one\ntwo\nthree\n";
        const edits = [
            createTextEdit(createRange(0, 1, 0, 3), "1"),
            createTextEdit(createRange(1, 0, 2, 2), "2\n2"),
            createTextEdit(createRange(2, 3, 2, 5), ""),
        ];

        const forward = roundTrip(text, edits);
        const shuffled = roundTrip(text, [edits[2], edits[0], edits[1]]);

        expect(forward.undone).toBe(text);
        expect(shuffled.after).toBe(forward.after);
        expect(shuffled.undone).toBe(text);
    });
});
