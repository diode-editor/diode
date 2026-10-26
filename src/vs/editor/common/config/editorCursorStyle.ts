import type { CursorStyle } from "@tuidom/core/common/cursorStyle";

/** `editor.cursorStyle` values, as upstream's `TextEditorCursorStyle` string forms. */
export type EditorCursorStyleSetting =
    | "line"
    | "block"
    | "underline"
    | "line-thin"
    | "block-outline"
    | "underline-thin";

/** `editor.cursorBlinking` values, as upstream's `TextEditorCursorBlinkingStyle` string forms. */
export type EditorCursorBlinkingSetting = "blink" | "smooth" | "phase" | "expand" | "solid";

/**
 * The terminal cursor for the two settings. A terminal has three shapes and two blink modes, so the
 * thin and outline variants fold into their base shape and every animation but `solid` blinks.
 * An unset `editor.cursorStyle` is `null`: the terminal keeps the shape its user configured.
 */
export function toTerminalCursorStyle(
    style: EditorCursorStyleSetting | undefined,
    blinking: EditorCursorBlinkingSetting,
): CursorStyle | null {
    if (style === undefined) return null;
    const shape =
        style === "block" || style === "block-outline"
            ? "block"
            : style === "line" || style === "line-thin"
              ? "bar"
              : "underline";
    return { shape, blinking: blinking !== "solid" };
}
