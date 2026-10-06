import { describe, expect, it } from "vitest";

import { charToKey, validateKey } from "./keys.ts";

describe("validateKey", () => {
    it("именованные клавиши и одиночные символы проходят; регистр нормализуется", () => {
        expect(validateKey("Enter")).toBe("Enter");
        expect(validateKey("arrowdown")).toBe("ArrowDown");
        expect(validateKey("f12")).toBe("F12");
        expect(validateKey("a")).toBe("a");
        expect(validateKey("ж")).toBe("ж");
        expect(validateKey("ctrl+shift+p")).toBe("Ctrl+Shift+p");
        expect(validateKey("Alt+F")).toBe("Alt+F");
        expect(validateKey("Meta+s")).toBe("Meta+s");
        expect(validateKey("Ctrl++")).toBe("Ctrl++");
        expect(validateKey("Shift+Tab")).toBe("Shift+Tab");
    });

    it("«Down» не уезжает в редактор четырьмя буквами — ошибка с подсказкой", () => {
        expect(() => validateKey("Down")).toThrow('неизвестная клавиша "Down" — может, ArrowDown?');
        expect(() => validateKey("Shift+Up")).toThrow("может, Shift+ArrowUp?");
        expect(() => validateKey("Esc")).toThrow("может, Escape?");
    });

    it("незнакомое без подсказки — ошибка со списком имён", () => {
        expect(() => validateKey("Foo")).toThrow(/неизвестная клавиша "Foo" Имена: Enter, Tab/);
    });

    it("модификаторы: синонимы и опечатки", () => {
        expect(validateKey("Control+a")).toBe("Ctrl+a");
        expect(validateKey("cmd+s")).toBe("Meta+s");
        expect(() => validateKey("Hyper+a")).toThrow('неизвестный модификатор "Hyper" в "Hyper+a"');
        expect(() => validateKey("Esc+a")).toThrow('неизвестный модификатор "Esc"');
    });
});

describe("charToKey", () => {
    it("пробел, перевод строки, таб — именами; остальное как есть", () => {
        expect(charToKey(" ")).toBe("Space");
        expect(charToKey("\n")).toBe("Enter");
        expect(charToKey("\r")).toBe("Enter");
        expect(charToKey("\t")).toBe("Tab");
        expect(charToKey("x")).toBe("x");
    });
});
