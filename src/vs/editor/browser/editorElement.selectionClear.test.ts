import { describe, expect, it } from "vitest";

import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TuiApplication } from "@tuidom/core/dom/tuiApplication";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { EditorElement } from "./editorElement.ts";

describe("EditorElement in app frame loop", () => {
    it("clears stale selection background between frames", () => {
        const backend = new MockTerminalBackend(new Size(12, 3));
        const app = new TuiApplication(backend);

        const doc = new TextDocument("hello");
        const viewState = new EditorViewState(doc);
        const editor = new EditorElement(viewState);
        editor.occurrenceHighlightEnabled = false; // isolate selection-bg clearing from word highlighting
        const body = new BodyElement();
        body.setContent(editor);
        app.root = body;
        app.run();

        editor.focusable = true;
        editor.focus();

        // Select "ello": cursor to end, then select left 4 times
        viewState.cursorEnd();
        viewState.cursorLeft(true);
        viewState.cursorLeft(true);
        viewState.cursorLeft(true);
        viewState.cursorLeft(true);
        editor.markDirty();
        backend.sendKey("F12"); // trigger render

        // "ello" chars 1..4 of "hello" appear at screen x = gutterWidth + 1..4
        const gw = editor.gutterWidth;
        for (let x = 1; x <= 4; x++) {
            expect(backend.getBgAt(new Point(gw + x, 0))).not.toBe(DEFAULT_COLOR);
        }

        // Deselect by collapsing selection
        viewState.cursorRight();
        editor.markDirty();
        backend.sendKey("F12"); // trigger render

        // Previously selected cells should now be cleared back to DEFAULT_COLOR
        for (let x = 1; x <= 4; x++) {
            expect(backend.getBgAt(new Point(gw + x, 0))).toBe(DEFAULT_COLOR);
        }
    });
});
