import { describe, expect, it } from "vitest";

import {
    cursorStyleFromApi,
    cursorStyleToApi,
    type EditorCursorStyleSetting,
    toTerminalCursorStyle,
} from "./editorCursorStyle.ts";

describe("toTerminalCursorStyle", () => {
    it("an unset editor.cursorStyle leaves the terminal's shape, whatever the blinking", () => {
        expect(toTerminalCursorStyle(undefined, "blink")).toBeNull();
        expect(toTerminalCursorStyle(undefined, "solid")).toBeNull();
    });

    it.each<[EditorCursorStyleSetting, "block" | "underline" | "bar"]>([
        ["line", "bar"],
        ["line-thin", "bar"],
        ["block", "block"],
        ["block-outline", "block"],
        ["underline", "underline"],
        ["underline-thin", "underline"],
    ])("%s is a %s cursor", (style, shape) => {
        expect(toTerminalCursorStyle(style, "blink")).toEqual({ shape, blinking: true });
    });

    it("only solid is steady; every other animation blinks", () => {
        expect(toTerminalCursorStyle("line", "solid")).toEqual({ shape: "bar", blinking: false });
        for (const blinking of ["blink", "smooth", "phase", "expand"] as const) {
            expect(toTerminalCursorStyle("line", blinking)?.blinking).toBe(true);
        }
    });
});

describe("cursorStyleFromApi / cursorStyleToApi", () => {
    it.each<[number, EditorCursorStyleSetting]>([
        [1, "line"],
        [2, "block"],
        [3, "underline"],
        [4, "line-thin"],
        [5, "block-outline"],
        [6, "underline-thin"],
    ])("TextEditorCursorStyle %i is %s and back", (value, style) => {
        expect(cursorStyleFromApi(value)).toBe(style);
        expect(cursorStyleToApi(style)).toBe(value);
    });

    it("a value outside the enum is no style", () => {
        for (const value of [0, 7, -1, 1.5, Number.NaN, "2", null, undefined]) {
            expect(cursorStyleFromApi(value)).toBeUndefined();
        }
        expect(cursorStyleToApi("bar")).toBeUndefined();
        expect(cursorStyleToApi(undefined)).toBeUndefined();
    });
});
