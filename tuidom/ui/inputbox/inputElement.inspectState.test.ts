import { describe, expect, it } from "vitest";

import { InputElement } from "./inputElement.ts";

describe("InputElement.inspectState", () => {
    it("отдаёт value, cursorOffset, hasSelection и showsPlaceholder", () => {
        const input = new InputElement();
        input.placeholder = "Message";
        expect(input.inspectState()).toEqual({
            value: "",
            cursorOffset: 0,
            hasSelection: false,
            showsPlaceholder: true,
        });

        input.inputState.insert("hi");
        expect(input.inspectState()).toEqual({
            value: "hi",
            cursorOffset: 2,
            hasSelection: false,
            showsPlaceholder: false,
        });
    });

    it("без плейсхолдера пустое значение не считается плейсхолдером", () => {
        const input = new InputElement();
        expect(input.inspectState()!.showsPlaceholder).toBe(false);
    });
});
