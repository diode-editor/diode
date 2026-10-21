import { describe, expect, it } from "vitest";

import { charToKey, validateKey } from "./keys.ts";

describe("validateKey", () => {
    it("named keys and single chars pass; case is normalized", () => {
        expect(validateKey("Enter")).toBe("Enter");
        expect(validateKey("arrowdown")).toBe("ArrowDown");
        expect(validateKey("f12")).toBe("F12");
        expect(validateKey("a")).toBe("a");
        expect(validateKey("\u0436")).toBe("\u0436"); // "zh"
        expect(validateKey("ctrl+shift+p")).toBe("Ctrl+Shift+p");
        expect(validateKey("Alt+F")).toBe("Alt+F");
        expect(validateKey("Meta+s")).toBe("Meta+s");
        expect(validateKey("Ctrl++")).toBe("Ctrl++");
        expect(validateKey("Shift+Tab")).toBe("Shift+Tab");
    });

    it('"Down" does not reach the editor as four letters: error with a hint', () => {
        expect(() => validateKey("Down")).toThrow('unknown key "Down" — did you mean ArrowDown?');
        expect(() => validateKey("Shift+Up")).toThrow("did you mean Shift+ArrowUp?");
        expect(() => validateKey("Esc")).toThrow("did you mean Escape?");
    });

    it("unknown without a hint: error with the list of names", () => {
        expect(() => validateKey("Foo")).toThrow(/unknown key "Foo" Names: Enter, Tab/);
    });

    it("modifiers: synonyms and typos", () => {
        expect(validateKey("Control+a")).toBe("Ctrl+a");
        expect(validateKey("cmd+s")).toBe("Meta+s");
        expect(() => validateKey("Hyper+a")).toThrow('unknown modifier "Hyper" in "Hyper+a"');
        expect(() => validateKey("Esc+a")).toThrow('unknown modifier "Esc"');
    });
});

describe("charToKey", () => {
    it("space, newline, tab by name; the rest as is", () => {
        expect(charToKey(" ")).toBe("Space");
        expect(charToKey("\n")).toBe("Enter");
        expect(charToKey("\r")).toBe("Enter");
        expect(charToKey("\t")).toBe("Tab");
        expect(charToKey("x")).toBe("x");
    });
});
