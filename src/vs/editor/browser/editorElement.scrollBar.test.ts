import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { MouseEventDispatcher } from "@tuidom/core/dom/events/mouseEventDispatcher";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const WIDTH = 30;
const HEIGHT = 10;

function mouse(action: MouseToken["action"], x: number, y: number): MouseToken {
    // Terminal coordinates are 1-based.
    return {
        kind: "mouse",
        action,
        button: "left",
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

/** A 100-line editor in a scrollbar decorator, 30×10: the vertical bar is column 29. */
function createScene(text = Array.from({ length: 100 }, (_, i) => `line${String(i)}`).join("\n")): {
    app: TestApp;
    editor: EditorElement;
    send: (action: MouseToken["action"], x: number, y: number) => void;
} {
    const editor = new EditorElement(new EditorViewState(new TextDocument(text)));
    const app = TestApp.createWithContent(new ScrollBarDecorator(editor), new Size(WIDTH, HEIGHT));
    app.render();
    const dispatcher = new MouseEventDispatcher();
    return {
        app,
        editor,
        send: (action, x, y) => {
            dispatcher.handleMouseToken(mouse(action, x, y), app.root);
            app.render();
        },
    };
}

function firstRowText(app: TestApp): string {
    return app.backend.getTextAt(new Point(0, 0), WIDTH - 1);
}

describe("EditorElement – scrollbar mouse", () => {
    it("a press on the track scrolls the text to it", () => {
        const { app, editor, send } = createScene();
        expect(firstRowText(app)).toContain("line0");

        send("press", WIDTH - 1, HEIGHT - 1);

        expect(editor.scrollTop).toBe(90);
        expect(firstRowText(app)).toContain("line90");
    });

    it("dragging the thumb scrolls the text along", () => {
        const { app, editor, send } = createScene();
        send("press", WIDTH - 1, 0);
        send("move", WIDTH - 1, 3);
        expect(editor.scrollTop).toBe(30);
        expect(firstRowText(app)).toContain("line30");

        // The pointer leaves the bar: the drag goes on.
        send("move", 5, 6);
        expect(editor.scrollTop).toBe(60);

        send("release", 5, 6);
        send("move", WIDTH - 1, 1);
        expect(editor.scrollTop).toBe(60);
    });
});

describe("EditorElement.scrollTo", () => {
    it("clamps to the content", () => {
        const { editor } = createScene(`${"a".repeat(80)}\n${Array.from({ length: 30 }, () => "b").join("\n")}`);

        editor.scrollTo(-5, 1000);
        expect(editor.scrollLeft).toBe(0);
        expect(editor.scrollTop).toBe(editor.viewState.getViewLineCount() - editor.viewState.viewportHeight);

        editor.scrollTo(1000, -5);
        expect(editor.scrollTop).toBe(0);
        expect(editor.scrollLeft).toBe(editor.contentWidth - editor.viewState.viewportWidth);
    });
});
