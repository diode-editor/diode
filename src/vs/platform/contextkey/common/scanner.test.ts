import { describe, expect, it } from "vitest";

import { scanWhen } from "./scanner.ts";

/** Ожидания перенесены из upstream `contextkey/test/common/scanner.test.ts` (там `===` — отдельный тип, у нас — `==`). */
describe("scanWhen", () => {
    it("ключ с символами, которые VS Code допускает в имени", () => {
        expect(scanWhen("foo.bar<C-shift+2>")).toEqual([
            { type: "str", lexeme: "foo.bar<C-shift+2>", offset: 0 },
            { type: "eof", offset: 18 },
        ]);
    });

    it("отрицание, скобки, && и ||", () => {
        expect(scanWhen("!(foo && bar) || baz")).toEqual([
            { type: "!", offset: 0 },
            { type: "(", offset: 1 },
            { type: "str", lexeme: "foo", offset: 2 },
            { type: "&&", offset: 6 },
            { type: "str", lexeme: "bar", offset: 9 },
            { type: ")", offset: 12 },
            { type: "||", offset: 14 },
            { type: "str", lexeme: "baz", offset: 17 },
            { type: "eof", offset: 20 },
        ]);
    });

    it("== и === — одна лексема, != и !== — тоже", () => {
        expect(scanWhen("a == b")[1]).toEqual({ type: "==", offset: 2 });
        expect(scanWhen("a === b")).toEqual([
            { type: "str", lexeme: "a", offset: 0 },
            { type: "==", offset: 2 },
            { type: "str", lexeme: "b", offset: 6 },
            { type: "eof", offset: 7 },
        ]);
        expect(scanWhen("a != b")[1]).toEqual({ type: "!=", offset: 2 });
        expect(scanWhen("a  !== b")).toEqual([
            { type: "str", lexeme: "a", offset: 0 },
            { type: "!=", offset: 3 },
            { type: "str", lexeme: "b", offset: 7 },
            { type: "eof", offset: 8 },
        ]);
    });

    it("сравнения < <= > >= — и без пробелов", () => {
        expect(scanWhen("a<1").map((t) => t.type)).toEqual(["str", "eof"]); // `<` — символ слова
        expect(scanWhen("a < 1 && b <= 2 && c > 3 && d >= -1").map((t) => t.type)).toEqual([
            "str",
            "<",
            "str",
            "&&",
            "str",
            "<=",
            "str",
            "&&",
            "str",
            ">",
            "str",
            "&&",
            "str",
            ">=",
            "str",
            "eof",
        ]);
        expect(scanWhen("foo.bar >= -1")).toEqual([
            { type: "str", lexeme: "foo.bar", offset: 0 },
            { type: ">=", offset: 8 },
            { type: "str", lexeme: "-1", offset: 11 },
            { type: "eof", offset: 13 },
        ]);
    });

    it("равенство без пробелов отделяет ключ от значения", () => {
        expect(scanWhen("foo.bar:zed==completed")).toEqual([
            { type: "str", lexeme: "foo.bar:zed", offset: 0 },
            { type: "==", offset: 11 },
            { type: "str", lexeme: "completed", offset: 13 },
            { type: "eof", offset: 22 },
        ]);
    });

    it("ключевые слова true/false/in/not", () => {
        expect(scanWhen("true false in not x").map((t) => t.type)).toEqual([
            "true",
            "false",
            "in",
            "not",
            "str",
            "eof",
        ]);
    });

    it("строка в одинарных кавычках — без кавычек, смещение — после открывающей", () => {
        expect(scanWhen("a == 'b c'")).toEqual([
            { type: "str", lexeme: "a", offset: 0 },
            { type: "==", offset: 2 },
            { type: "quotedStr", lexeme: "b c", offset: 6 },
            { type: "eof", offset: 10 },
        ]);
    });

    it("регекс с флагами; экранированный слэш и слэш в классе символов не закрывают", () => {
        expect(scanWhen("foo =~ /zee/gim")).toEqual([
            { type: "str", lexeme: "foo", offset: 0 },
            { type: "=~", offset: 4 },
            { type: "regexStr", lexeme: "/zee/gim", offset: 7 },
            { type: "eof", offset: 15 },
        ]);
        expect(scanWhen(String.raw`r =~ /\/Objects\/.+\.xml$/`)[2]).toEqual({
            type: "regexStr",
            lexeme: String.raw`/\/Objects\/.+\.xml$/`,
            offset: 5,
        });
        expect(scanWhen("r =~ /[/]x/ && y").map((t) => t.type)).toEqual(["str", "=~", "regexStr", "&&", "str", "eof"]);
        expect(scanWhen("r =~ /[/]x/")[2]).toEqual({ type: "regexStr", lexeme: "/[/]x/", offset: 5 });
        // Слэш в классе после другого символа класса — тоже не закрывает.
        expect(scanWhen("r =~ /[a/]/")[2]).toEqual({ type: "regexStr", lexeme: "/[a/]/", offset: 5 });
        // После `]` класс закрыт — следующий `/` снова закрывает регекс.
        expect(scanWhen("r =~ /[a]/x")[2]).toEqual({ type: "regexStr", lexeme: "/[a]/", offset: 5 });
    });

    it("пробельные символы (включая nbsp) пропускаются", () => {
        expect(scanWhen(" \t\r\n a").map((t) => t.type)).toEqual(["str", "eof"]);
    });

    it("символ вне класса слова пропускается молча, как у upstream", () => {
        expect(scanWhen("a {")).toEqual([
            { type: "str", lexeme: "a", offset: 0 },
            { type: "eof", offset: 3 },
        ]);
    });

    describe("ошибки лексики", () => {
        it("одиночные = & | — лексема error", () => {
            expect(scanWhen("a = b")[1]).toEqual({ type: "error", offset: 2, lexeme: "=" });
            expect(scanWhen("a & b")[1]).toEqual({ type: "error", offset: 2, lexeme: "&" });
            expect(scanWhen("foo|bar")).toEqual([
                { type: "str", lexeme: "foo", offset: 0 },
                { type: "error", offset: 3, lexeme: "|" },
                { type: "str", lexeme: "bar", offset: 4 },
                { type: "eof", offset: 7 },
            ]);
            expect(scanWhen("vim<c-r>==1 && vim<2<=3")[5]).toEqual({ type: "error", offset: 21, lexeme: "=" });
        });

        it("незакрытая кавычка — error до конца строки", () => {
            expect(scanWhen("foo && 'bar")).toEqual([
                { type: "str", lexeme: "foo", offset: 0 },
                { type: "&&", offset: 4 },
                { type: "error", offset: 7, lexeme: "'bar" },
                { type: "eof", offset: 11 },
            ]);
        });

        it("незакрытый регекс — error до конца строки", () => {
            expect(scanWhen("foo =~ /file:\\/ || bar")).toEqual([
                { type: "str", lexeme: "foo", offset: 0 },
                { type: "=~", offset: 4 },
                { type: "error", offset: 7, lexeme: "/file:\\/ || bar" },
                { type: "eof", offset: 22 },
            ]);
            // Слэш внутри незакрытого класса символов регекс не закрывает.
            expect(scanWhen("r =~ /[/x")[2]).toEqual({ type: "error", offset: 5, lexeme: "/[/x" });
        });
    });
});
