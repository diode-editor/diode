import { describe, expect, it } from "vitest";

import { charClass, findWordRangeAt, isWordChar } from "./wordClassification.ts";

describe("charClass / isWordChar", () => {
    it("разделяет пробел, пунктуацию и символ слова", () => {
        expect(charClass(" ")).toBe(0);
        expect(charClass("\t")).toBe(0);
        expect(charClass(".")).toBe(1);
        expect(charClass("a")).toBe(2);
    });

    it("словом считается ровно один символ: пустая строка — граница строки", () => {
        expect(isWordChar("a")).toBe(true);
        expect(isWordChar("")).toBe(false);
        expect(isWordChar("ab")).toBe(false);
        expect(isWordChar(".")).toBe(false);
    });
});

describe("findWordRangeAt", () => {
    it("находит слово под кареткой и сразу за его концом", () => {
        expect(findWordRangeAt("foo bar", 1)).toEqual({ start: 0, end: 3 });
        expect(findWordRangeAt("foo bar", 3)).toEqual({ start: 0, end: 3 });
        expect(findWordRangeAt("foo bar", 4)).toEqual({ start: 4, end: 7 });
    });

    it("на пробеле и пунктуации слова нет", () => {
        expect(findWordRangeAt(" foo", 0)).toBeNull();
        // Между двумя разделителями: ни под кареткой, ни перед ней слова нет.
        expect(findWordRangeAt("a..b", 2)).toBeNull();
        expect(findWordRangeAt("", 0)).toBeNull();
    });

    /**
     * Позиция каретки приезжает из состояния вью и бывает «протухшей» на кадр
     * (правка мимо вью, позиция от расширения). Раньше такая позиция роняла ВЕСЬ
     * редактор: `line[character - 1]` давал undefined, и чтение `.length` летело
     * из render — highlight вхождений зовётся оттуда, и ловить исключение некому.
     */
    describe("позиция вне строки", () => {
        it("за концом строки — слово у конца, без падения", () => {
            expect(findWordRangeAt("foo", 4)).toEqual({ start: 0, end: 3 });
            expect(findWordRangeAt("foo", 999)).toEqual({ start: 0, end: 3 });
        });

        it("за концом строки без слова у конца — null, без падения", () => {
            expect(findWordRangeAt("foo ", 42)).toBeNull();
            expect(findWordRangeAt("", 7)).toBeNull();
        });

        it("отрицательная позиция читается как начало строки", () => {
            expect(findWordRangeAt("foo bar", -1)).toEqual({ start: 0, end: 3 });
            expect(findWordRangeAt(" foo", -5)).toBeNull();
        });

        it("дробная позиция обрезается к целой колонке", () => {
            // 3.9 — это всё ещё колонка 3 (конец «foo»), а не начало «bar».
            expect(findWordRangeAt("foo bar", 3.9)).toEqual({ start: 0, end: 3 });
        });

        it("NaN не находит слова и не падает", () => {
            expect(findWordRangeAt("foo", Number.NaN)).toBeNull();
        });
    });
});
