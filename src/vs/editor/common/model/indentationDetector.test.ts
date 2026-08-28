import { describe, expect, it } from "vitest";

import { detectIndentation, type IIndentationDefaults } from "./indentationDetector.ts";
import { TextDocument } from "./textDocument.ts";

function makeDoc(lines: string[]): TextDocument {
    return new TextDocument(lines.join("\n"));
}

/** Дефолты «как в реестре настроек» — чтобы видеть, когда файл промолчал. */
const SPACES_4: IIndentationDefaults = { tabSize: 4, insertSpaces: true };

describe("detectIndentation", () => {
    it("detects 2 spaces in a package.json-shaped file", () => {
        // Регрессия: файл целиком состоит из уровней 2 и 4, и «самая частая
        // ширина отступа» здесь равна 4 — шаг же равен 2.
        const doc = makeDoc([
            "{",
            '  "name": "diode",',
            '  "scripts": {',
            '    "build": "tsup",',
            '    "test": "vitest run"',
            "  },",
            '  "engines": {',
            '    "node": ">=24.0.0"',
            "  }",
            "}",
        ]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 2 });
    });

    it("is not thrown off by the single-space continuation of a block comment", () => {
        // Регрессия: ` * …` даёт ширину отступа 1, и любой счёт по абсолютным
        // ширинам (GCD) обнулял бы им весь файл.
        const doc = makeDoc([
            "/**",
            " * Does things.",
            " */",
            "function foo() {",
            "    if (x) {",
            "        return 1;",
            "    }",
            "}",
        ]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
    });

    it("detects tabs and leaves the tab width to the defaults", () => {
        const doc = makeDoc(["function foo() {", "\tif (x) {", "\t\treturn 1;", "\t}", "}"]);

        expect(detectIndentation(doc, { tabSize: 8, insertSpaces: true })).toEqual({
            insertSpaces: false,
            tabSize: 8,
        });
    });

    it("falls back to the defaults for a file without indentation", () => {
        const doc = makeDoc(["hello", "world"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
        expect(detectIndentation(doc, { tabSize: 2, insertSpaces: false })).toEqual({
            insertSpaces: false,
            tabSize: 2,
        });
    });

    it("falls back to the defaults for an empty document", () => {
        expect(detectIndentation(makeDoc([]), SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
    });

    it("detects 8-space indentation — предельный кандидат", () => {
        const doc = makeDoc(["a() {", "        b;", "        c;", "}"]);

        expect(detectIndentation(doc, { tabSize: 2, insertSpaces: true })).toEqual({
            insertSpaces: true,
            tabSize: 8,
        });
    });

    it("отступ пробелами перебивает defaults.insertSpaces=false", () => {
        const doc = makeDoc(["function foo() {", "  const x = 1;", "}"]);

        expect(detectIndentation(doc, { tabSize: 4, insertSpaces: false })).toEqual({
            insertSpaces: true,
            tabSize: 2,
        });
    });

    it("при отступе табами ширина берётся из defaults, а не из пробельных строк файла", () => {
        // Табов больше, чем пробельных строк, — файл табовый; шаг 2, набранный
        // по пробельным строкам, к ширине таба отношения не имеет.
        const doc = makeDoc(["\ta", "\tb", "\tc", "  x", "    y"]);

        expect(detectIndentation(doc, { tabSize: 8, insertSpaces: true })).toEqual({
            insertSpaces: false,
            tabSize: 8,
        });
    });

    it("falls back to defaults.insertSpaces when tabs and spaces tie", () => {
        const doc = makeDoc(["\ttab;", "  spaces;"]);

        expect(detectIndentation(doc, SPACES_4).insertSpaces).toBe(true);
        expect(detectIndentation(doc, { tabSize: 4, insertSpaces: false }).insertSpaces).toBe(false);
    });

    it("compares indentation across blank lines", () => {
        const doc = makeDoc(["function f() {", "", "    a;", "", "    b;", "", "}"]);

        expect(detectIndentation(doc, { tabSize: 2, insertSpaces: true })).toEqual({
            insertSpaces: true,
            tabSize: 4,
        });
    });

    it("ignores whitespace-only lines", () => {
        const doc = makeDoc(["function f() {", "    a;", "        ", "    b;", "}"]);

        expect(detectIndentation(doc, { tabSize: 2, insertSpaces: true })).toEqual({
            insertSpaces: true,
            tabSize: 4,
        });
    });

    it("ширина пробельной строки не попадает в гистограмму шагов", () => {
        // Пробельные строки на 6 позиций среди двухпробельного кода: посчитай их
        // за содержательные — и шаг 4 забьёт настоящую двойку.
        const doc = makeDoc(["a", "  b", "      ", "  c", "      ", "  d"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 2 });
    });

    it("пробельная строка не считается отступлённой на один символ", () => {
        // Тот же капкан с другой стороны: если у пробельной строки «отступ 1»,
        // шаги с четвёрок съезжают на тройки и tabSize становится 3.
        const doc = makeDoc(["a", "    b", "    ", "    c", "    ", "    d", "    ", "    e"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
    });

    it("пробельная строка не голосует в споре табов с пробелами", () => {
        // Таб против пробелов — ничья, решают defaults. Пробельная строка в шесть
        // пробелов не должна её ломать: отступа в ней нет, есть только пробелы.
        const doc = makeDoc(["\ta", "  b", "      "]);

        expect(detectIndentation(doc, { tabSize: 4, insertSpaces: false }).insertSpaces).toBe(false);
    });

    it("строки с одним ведущим пробелом не делают файл пробельным", () => {
        // Файл целиком из блочного комментария: ` * …` — это выравнивание
        // звёздочек, а не отступ, и голоса за пробелы здесь нет вовсе.
        const doc = makeDoc(["/**", " * a", " */"]);

        expect(detectIndentation(doc, { tabSize: 4, insertSpaces: false }).insertSpaces).toBe(false);
    });

    it("ignores a step wider than the largest guess", () => {
        const doc = makeDoc(["a", "          b"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
    });

    it("lets 2 win over 4 when it is at least half as frequent", () => {
        const doc = makeDoc(["a", "    b", "a", "    b", "  c", "    d"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 2 });
    });

    it("ровно половина частоты четвёрки — двойка ещё выигрывает", () => {
        // Шаги: 4 × 4, 2 × 2 — граница правила «хотя бы вполовину так же часто».
        const doc = makeDoc(["a", "    b", "a", "    b", "a", "  c", "a"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 2 });
    });

    it("правило «двойка вместо четвёрки» не трогает победившую шестёрку", () => {
        // Шаги: 6 × 5, 2 × 3, 4 × 1 — побеждает 6, и переезд на 2 был бы враньём.
        const doc = makeDoc(["a", "      b", "a", "      b", "a", "      b", "    c", "a", "  d", "a"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 6 });
    });

    describe("mixed tabs and spaces", () => {
        it("ignores a step where either side mixes tabs and spaces", () => {
            // Первая строка ловит смешанный хвост как «текущая», вторая — как «предыдущая».
            const doc = makeDoc(["  \ta", "x"]);

            expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: false, tabSize: 4 });
        });

        it("reads the tab width off a tabs → spaces step when it divides evenly", () => {
            const doc = makeDoc(["\t\tx", "    y", "    z"]);

            expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 2 });
        });

        it("ignores a tabs → spaces step that does not divide evenly", () => {
            const doc = makeDoc(["\t\tx", "   y", "   z", "   w"]);

            expect(detectIndentation(doc, { tabSize: 3, insertSpaces: true })).toEqual({
                insertSpaces: true,
                tabSize: 3,
            });
        });
    });

    describe("continuation lines", () => {
        it("ignores a line aligned under the arguments of the previous one", () => {
            // Без этой эвристики шаг 7 стал бы единственным кандидатом и победил.
            const doc = makeDoc(["foo(a, b,", "       c);"]);

            expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
        });

        it("counts the same shape when the previous line does not end in a comma", () => {
            const doc = makeDoc(["foo(a, b;", "       c);"]);

            expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 7 });
        });
    });
});
