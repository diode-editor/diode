import { describe, expect, it } from "vitest";

import { type EditorCursorStyleSetting, toTerminalCursorStyle } from "./editorCursorStyle.ts";

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
