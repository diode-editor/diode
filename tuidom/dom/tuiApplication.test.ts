import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../src/TestUtils/expectScreen.ts";
import { EditorElement } from "../../src/vs/editor/browser/editorElement.ts";
import { TextDocument } from "../../src/vs/editor/common/model/textDocument.ts";
import { EditorViewState } from "../../src/vs/editor/common/viewModel/editorViewState.ts";
import { MockTerminalBackend } from "../backend/mockTerminalBackend.ts";
import { DEFAULT_COLOR } from "../common/colorUtils.ts";
import { Point, Size } from "../common/geometryPromitives.ts";
import { BodyElement } from "../ui/body/bodyElement.ts";
import { BoxElement } from "../ui/layout/boxElement.ts";

import { TuiApplication } from "./tuiApplication.ts";

describe("TuiApplication", () => {
    it("renders root element on run()", () => {
        const backend = new MockTerminalBackend(new Size(6, 3));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const box = new BoxElement();
        body.setContent(box);
        app.root = body;
        app.run();

        expectScreen(
            backend,
            screen`
                +----+
                |    |
                +----+
            `,
        );
    });

    it("sets root size to match terminal dimensions", () => {
        const backend = new MockTerminalBackend(new Size(10, 5));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const box = new BoxElement();
        body.setContent(box);
        app.root = body;
        app.run();

        expect(body.layoutSize.width).toBe(10);
        expect(body.layoutSize.height).toBe(5);
    });

    it("re-renders with new size on terminal resize", () => {
        const backend = new MockTerminalBackend(new Size(6, 3));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const box = new BoxElement();
        body.setContent(box);
        app.root = body;
        app.run();

        // Verify initial render
        expectScreen(
            backend,
            screen`
                +----+
                |    |
                +----+
            `,
        );

        // Simulate resize
        backend.resize(new Size(8, 4));

        expectScreen(
            backend,
            screen`
                +------+
                |      |
                |      |
                +------+
            `,
        );

        expect(body.layoutSize.width).toBe(8);
        expect(body.layoutSize.height).toBe(4);
    });

    it("updates screen dimensions on resize", () => {
        const backend = new MockTerminalBackend(new Size(10, 5));
        const app = new TuiApplication(backend);
        const body = new BodyElement();
        body.setContent(new BoxElement());
        app.root = body;
        app.run();

        expect(app.screen.width).toBe(10);
        expect(app.screen.height).toBe(5);

        backend.resize(new Size(20, 10));

        expect(app.screen.width).toBe(20);
        expect(app.screen.height).toBe(10);
    });

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
