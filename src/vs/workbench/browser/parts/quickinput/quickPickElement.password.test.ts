import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { describe, expect, it, vi } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { MASK_CHAR, QuickPickElement } from "./quickPickElement.ts";

// The mask is presentation only, so the tests check both sides: the frame and the query.

function makePicker(width = 24): QuickPickElement {
    const picker = new QuickPickElement();
    picker.preferredWidth = width;
    picker.placeholder = "";
    return picker;
}

function render(picker: QuickPickElement, width = 24) {
    return renderElement(picker, width, picker.getMinIntrinsicHeight(width), { themeVars: true });
}

function type(picker: QuickPickElement, text: string): void {
    for (const char of text) {
        picker.inputElement.dispatchEvent(new TUIKeyboardEvent("keydown", { key: char }));
    }
}

describe("QuickPickElement — password input", () => {
    it("without password the typed text is shown as is", () => {
        const picker = makePicker();
        picker.setQuery("hunter2");
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │ hunter2              │
                ╰──────────────────────╯
            `,
        );
    });

    it("with password the frame shows one mask per character and no secret", () => {
        const picker = makePicker();
        picker.password = true;
        picker.setQuery("hunter2");
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │ *******              │
                ╰──────────────────────╯
            `,
        );
    });

    it("the mask is presentation only: the query and onQueryChange carry the real text", () => {
        const picker = makePicker();
        picker.password = true;
        const onQueryChange = vi.fn();
        picker.onQueryChange = onQueryChange;

        type(picker, "abc");

        expect(picker.getQuery()).toBe("abc");
        expect(onQueryChange).toHaveBeenLastCalledWith("abc");
    });

    it("Enter returns the real value, not the mask", () => {
        const picker = makePicker();
        picker.password = true;
        picker.acceptMode = "value";
        const onAcceptValue = vi.fn();
        picker.onAcceptValue = onAcceptValue;

        picker.setQuery("hunter2");
        picker.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onAcceptValue).toHaveBeenCalledWith("hunter2");
    });

    it("under the mask the inspector returns what the screen shows — the secret does not leak", () => {
        const picker = makePicker();
        picker.password = true;
        picker.setQuery("hunter2");

        expect(picker.inspectState().query).toBe(MASK_CHAR.repeat(7));
    });

    it("without the mask the inspector returns the query itself", () => {
        const picker = makePicker();
        picker.setQuery("hunter2");

        expect(picker.inspectState().query).toBe("hunter2");
    });

    it("a grapheme cluster is covered by ONE mask — both in the frame and in the inspector", () => {
        const picker = makePicker();
        picker.password = true;
        // "e" with a combining acute, "x" and an emoji: three graphemes from five UTF-16 code units.
        picker.setQuery("éx\u{1F512}");

        expect(picker.inspectState().query).toBe(MASK_CHAR.repeat(3));
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │ ***                  │
                ╰──────────────────────╯
            `,
        );
    });

    it("an empty masked input shows the placeholder, not zero masks", () => {
        const picker = makePicker();
        picker.password = true;
        picker.placeholder = "Password";
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │ Password             │
                ╰──────────────────────╯
            `,
        );
    });

    it("resetFlavorState clears the mask — the next show on the shared widget is not blind", () => {
        const picker = makePicker();
        picker.password = true;
        picker.setQuery("hunter2");
        render(picker);

        picker.resetFlavorState();
        picker.setQuery("query");

        expect(picker.password).toBe(false);
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │ query                │
                ╰──────────────────────╯
            `,
        );
    });
});
