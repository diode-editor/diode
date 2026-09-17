import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { createTextEdit } from "../core/iTextEdit.ts";

import { TextDocument } from "./textDocument.ts";

// Обратные правки батча — единственный пейлоад undo (см. UndoManager): после
// `applyEdits(edits)` применение `inverseEdits` обязано вернуть ДОСЛОВНО
// исходный текст. Ниже — формы батчей, на которых это ломалось: правки,
// схлопывающиеся в одну точку, и правки на строке, склеенной предыдущей
// правкой.

/** Прогоняет батч и его обратные правки, возвращая текст «после» и «после undo». */
function roundTrip(text: string, edits: readonly ITextEdit[]): { after: string; undone: string } {
    const doc = new TextDocument(text);
    const { inverseEdits } = doc.applyEdits(edits);
    const after = doc.getText();
    doc.applyEdits(inverseEdits);
    return { after, undone: doc.getText() };
}

describe("TextDocument.applyEdits — обратные правки батча", () => {
    it("возвращает импорт на место после quick fix «удалить неиспользуемый assert»", () => {
        // Форма ровно та, что присылает typescript-language-server (снято с
        // живого сервера): ДВА смежных удаления на одной строке — ", " и
        // "assert". В новом документе оба схлопываются в позицию (0,13), то
        // есть обратные правки — две вставки нулевой ширины В ОДНУ ТОЧКУ, и
        // порядок их применения решает всё.
        const line = 'import { test, assert } from "./test.js";';
        const { after, undone } = roundTrip(line, [
            createTextEdit(createRange(0, 13, 0, 15), ""),
            createTextEdit(createRange(0, 15, 0, 21), ""),
        ]);

        expect(after).toBe('import { test } from "./test.js";');
        expect(undone).toBe(line);
    });

    it("не переставляет местами вставки, попавшие в одну точку", () => {
        // Минимальная форма того же: два удаления вплотную. Перепутанный
        // порядок дал бы "cdab" внутри — текст той же длины, поэтому ассерт
        // обязан смотреть на содержимое, а не на длину.
        const { after, undone } = roundTrip("abcdXY", [
            createTextEdit(createRange(0, 0, 0, 2), ""),
            createTextEdit(createRange(0, 2, 0, 4), ""),
        ]);

        expect(after).toBe("XY");
        expect(undone).toBe("abcdXY");
    });

    it("учитывает склейку строк: правка на строке, приклеенной предыдущей правкой", () => {
        // Первая правка съедает перевод строки и приклеивает хвост второй
        // строки к первой — вторая правка едет и по строке, И по колонке.
        // Сдвиг только по строке (без колонки) промахнулся бы мимо.
        const text = "ab\ncdef\n";
        const { after, undone } = roundTrip(text, [
            createTextEdit(createRange(0, 1, 1, 1), ""),
            createTextEdit(createRange(1, 1, 1, 3), ""),
        ]);

        expect(after).toBe("af\n");
        expect(undone).toBe(text);
    });

    it("учитывает склейку строк, когда правка вставляет непустой текст", () => {
        // То же, но вставка непустая и многострочная: конец вставленного
        // текста — новая точка отсчёта для следующей правки.
        const text = "ab\ncdef\n";
        const { after, undone } = roundTrip(text, [
            createTextEdit(createRange(0, 1, 1, 1), "X\nYZ"),
            createTextEdit(createRange(1, 1, 1, 3), "Q"),
        ]);

        expect(after).toBe("aX\nYZQf\n");
        expect(undone).toBe(text);
    });

    it("сдвигает правку на следующих строках на накопленную разницу строк", () => {
        // Первая правка убирает строку (разница -1), вторая живёт НИЖЕ неё, на
        // отдельной строке. Её обратная правка обязана уехать вверх ровно на
        // эту разницу: сдвиг в другую сторону (или его отсутствие) вернул бы
        // текст на чужую строку.
        const text = "aaa\nbbb\nccc\nddd\n";
        const { after, undone } = roundTrip(text, [
            createTextEdit(createRange(0, 0, 1, 0), ""), // строка "aaa" целиком
            createTextEdit(createRange(2, 1, 2, 2), "X"), // одна буква в "ccc"
        ]);

        expect(after).toBe("bbb\ncXc\nddd\n");
        expect(undone).toBe(text);
    });

    it("сдвигает правку на следующих строках вниз, когда батч добавил строки", () => {
        // Зеркало предыдущего: первая правка ДОБАВЛЯЕТ строки (разница +2).
        const text = "aaa\nbbb\nccc\n";
        const { after, undone } = roundTrip(text, [
            createTextEdit(createRange(0, 1, 0, 2), "1\n2\n3"),
            createTextEdit(createRange(2, 1, 2, 2), "X"),
        ]);

        expect(after).toBe("a1\n2\n3a\nbbb\ncXc\n");
        expect(undone).toBe(text);
    });

    it("round-trip не зависит от порядка правок в батче", () => {
        // Батч от расширения приходит в произвольном порядке — обратные
        // правки обязаны быть одинаковыми независимо от него.
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
