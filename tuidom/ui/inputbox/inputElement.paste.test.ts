import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIPasteEvent } from "../../dom/events/tuiPasteEvent.ts";

import { InputElement } from "./inputElement.ts";

function createInput(): InputElement {
    const input = new InputElement();
    TestApp.createWithContent(input, new Size(40, 3));
    input.focus();
    return input;
}

describe("InputElement — bracketed paste", () => {
    it("inserts pasted text at the cursor", () => {
        const input = createInput();
        input.dispatchEvent(new TUIPasteEvent("hello"));
        expect(input.inputState.value).toBe("hello");
    });

    it("flattens newlines in a multi-line paste into spaces (single-line field)", () => {
        const input = createInput();
        input.dispatchEvent(new TUIPasteEvent("line one\nline two"));
        expect(input.inputState.value).toBe("line one line two");
    });

    it("fires onChange with the new value on paste", () => {
        const input = createInput();
        const onChange = vi.fn();
        input.onChange = onChange;
        input.dispatchEvent(new TUIPasteEvent("abc"));
        expect(onChange).toHaveBeenCalledWith("abc");
    });

    it("ignores an empty paste", () => {
        const input = createInput();
        const onChange = vi.fn();
        input.onChange = onChange;
        input.dispatchEvent(new TUIPasteEvent(""));
        expect(input.inputState.value).toBe("");
        expect(onChange).not.toHaveBeenCalled();
    });
});
