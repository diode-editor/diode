import { describe, expect, it } from "vitest";

import { computeIndentationStep } from "./indentationDetector.ts";

// Прямые тесты на шаг отступа между парой строк. Через `detectIndentation` эта
// функция видна только как сдвиг гистограммы, а он огрубляет: шаги 0, 1 и >8 в
// итоговый `tabSize` не попадают вовсе, и целый пласт решений про общий префикс,
// смешанные хвосты и выравнивание проверить оттуда нечем.

/** `indentOf("    x")` → 4. Тесты пишут строки, а не длины отступов. */
function indentOf(line: string): number {
    const match = /^[ \t]*/.exec(line);
    return match![0].length;
}

function step(a: string, b: string): { step: number; looksLikeAlignment: boolean } {
    const result = computeIndentationStep(a, indentOf(a), b, indentOf(b));
    return { step: result.step, looksLikeAlignment: result.looksLikeAlignment };
}

describe("computeIndentationStep — пробелы", () => {
    it("отступ первой строки считается от пустой затравки", () => {
        expect(step("", "  a")).toEqual({ step: 2, looksLikeAlignment: false });
    });

    it("одинаковый отступ — нулевой шаг", () => {
        expect(step("    a", "    b")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("углубление на один уровень", () => {
        expect(step("  a", "    b")).toEqual({ step: 2, looksLikeAlignment: false });
    });

    it("выход из уровня даёт тот же шаг, что и вход", () => {
        expect(step("        a", "    b")).toEqual({ step: 4, looksLikeAlignment: false });
    });

    it("шаг считается по хвосту после общего префикса, а не по полной ширине", () => {
        // Общий префикс — 4 пробела; отличаются только хвосты (0 и 3).
        expect(step("    a", "       b")).toEqual({ step: 3, looksLikeAlignment: false });
    });

    it("шаг больше восьмёрки возвращается как есть — отсекает его уже гистограмма", () => {
        expect(step("a", "            b")).toEqual({ step: 12, looksLikeAlignment: false });
    });
});

describe("computeIndentationStep — табы", () => {
    it("углубление табами при равном числе пробелов", () => {
        // Пробелов нет ни там, ни там: делить нечего, шаг нулевой.
        expect(step("\ta", "\t\tb")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("одинаковый отступ табами — нулевой шаг", () => {
        expect(step("\t\ta", "\t\tb")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("табы против пробелов: ширина таба = пробелы, делённые на съеденные табы", () => {
        expect(step("\t\ta", "    b")).toEqual({ step: 2, looksLikeAlignment: false });
        expect(step("\ta", "        b")).toEqual({ step: 8, looksLikeAlignment: false });
    });

    it("порядок не важен: пробелы в предыдущей строке, табы в текущей", () => {
        // Зеркало кейса выше. Проверка смеси смотрит на каждую строку отдельно,
        // и «в текущей есть табы» само по себе сигнал не отменяет.
        expect(step("    a", "\tb")).toEqual({ step: 4, looksLikeAlignment: false });
    });

    it("не делится нацело — сигнала нет", () => {
        expect(step("\t\ta", "   b")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("общий таб-префикс отбрасывается перед делением", () => {
        // Общий `\t`, дальше `\t` против четырёх пробелов → 4 / 1.
        expect(step("\t\ta", "\t    b")).toEqual({ step: 4, looksLikeAlignment: false });
    });
});

describe("computeIndentationStep — смешанные отступы", () => {
    it("предыдущая строка мешает табы с пробелами — сигнала нет", () => {
        expect(step("\t  a", "b")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("текущая строка мешает табы с пробелами — сигнала нет", () => {
        expect(step("a", "\t  b")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("смесь в общем префиксе не считается смесью: она отброшена", () => {
        // У обеих строк префикс `\t `, различаются только хвосты (0 и 4 пробела).
        expect(step("\t a", "\t     b")).toEqual({ step: 4, looksLikeAlignment: false });
    });
});

describe("computeIndentationStep — выровненное продолжение", () => {
    // `foo(a, b,` / `       c);` — `c` встал под аргументом предыдущей строки,
    // а не отступлен от неё.
    const CONTINUED = "foo(a, b,";
    const ALIGNED = "       c);";

    it("узнаёт продолжение, выровненное под аргумент", () => {
        expect(step(CONTINUED, ALIGNED)).toEqual({ step: 7, looksLikeAlignment: true });
    });

    it("предыдущая строка не кончается запятой — это обычный отступ", () => {
        expect(step("foo(a, b;", ALIGNED)).toEqual({ step: 7, looksLikeAlignment: false });
    });

    it("под первым символом продолжения в предыдущей строке не пробел — обычный отступ", () => {
        // `c` встаёт под `b`, а не под пробелом перед ним.
        expect(step(CONTINUED, "        c);")).toEqual({ step: 8, looksLikeAlignment: false });
    });

    it("продолжение само отступлено пробелом на этой позиции — обычный отступ", () => {
        // Символ на позиции `bSpaces` — пробел, значит это ещё отступ, а не текст.
        expect(step("    foo(a, b,", "     c);")).toEqual({ step: 1, looksLikeAlignment: false });
    });

    it("нулевой шаг выравниванием не считается", () => {
        expect(step("foo(a, b,", "foo(c, d,")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("выравнивание проверяется только при равном числе табов", () => {
        // Та же пара, но предыдущая строка отступлена табом: числа табов
        // разошлись → работает ветка деления, а у неё признака выравнивания нет.
        expect(step("\tfoo(a, b,", ALIGNED)).toEqual({ step: 7, looksLikeAlignment: false });
    });
});
