import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TUIPasteEvent } from "@tuidom/core/dom/events/tuiPasteEvent";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { currentCursorChangeSource, type CursorChangeSource } from "../common/core/cursorChangeSource.ts";
import { createSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

// The extension bridge reads the source SYNCHRONOUSLY from the cursor-change listener: without
// tagging in the input handlers every move would arrive with `kind === undefined`.

/** Editor plus a log of sources captured at each cursor change. */
function createEditor(text = "hello world\nsecond line\nthird") {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(40, 6));
    const sources: (CursorChangeSource | undefined)[] = [];
    viewState.onDidChangeCursorPosition(() => sources.push(currentCursorChangeSource()));
    return { app, editor, viewState, sources };
}

function fireMouse(editor: EditorElement, type: "mousedown" | "dblclick" | "mousemove", localX: number): void {
    editor.dispatchEvent(
        new TUIMouseEvent(type, {
            button: "left",
            screenX: localX,
            screenY: 0,
            localX,
            localY: 0,
        }),
    );
}

describe("EditorElement — cursor change source", () => {
    it("typing a character declares the keyboard source", () => {
        const { editor, sources } = createEditor();
        editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "x" }));
        expect(sources.length).toBeGreaterThan(0);
        expect(new Set(sources)).toEqual(new Set(["keyboard"]));
    });

    it("Enter declares the keyboard source", () => {
        const { editor, sources } = createEditor();
        editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
        expect(new Set(sources)).toEqual(new Set(["keyboard"]));
    });

    it("paste declares the keyboard source", () => {
        const { editor, sources } = createEditor();
        editor.dispatchEvent(new TUIPasteEvent("pasted text"));
        expect(new Set(sources)).toEqual(new Set(["keyboard"]));
    });

    it("mouse click declares the mouse source", () => {
        const { editor, sources } = createEditor();
        fireMouse(editor, "mousedown", editor.gutterWidth + 3);
        expect(sources.length).toBeGreaterThan(0);
        expect(new Set(sources)).toEqual(new Set(["mouse"]));
    });

    it("double click (word selection) declares the mouse source", () => {
        const { editor, sources } = createEditor();
        fireMouse(editor, "dblclick", editor.gutterWidth + 2);
        expect(new Set(sources)).toEqual(new Set(["mouse"]));
    });

    it("mouse drag declares the mouse source", () => {
        const { editor, sources } = createEditor();
        fireMouse(editor, "mousedown", editor.gutterWidth + 1);
        sources.length = 0;
        fireMouse(editor, "mousemove", editor.gutterWidth + 6);
        expect(sources.length).toBeGreaterThan(0);
        expect(new Set(sources)).toEqual(new Set(["mouse"]));
    });

    it("the source does not stay armed after the handler", () => {
        const { editor } = createEditor();
        fireMouse(editor, "mousedown", editor.gutterWidth + 1);
        expect(currentCursorChangeSource()).toBeUndefined();
    });

    it("a programmatic selection change outside gestures declares no source", () => {
        const { viewState, sources } = createEditor();
        viewState.selections = [createSelection(1, 0, 1, 4)];
        expect(sources).toEqual([undefined]);
    });
});
