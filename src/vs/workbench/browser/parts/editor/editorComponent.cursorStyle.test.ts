import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";

describe("EditorComponent — setCursorStyle", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-editor-cursor-style-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("a new shape reaches the terminal on the next frame; the same shape again schedules nothing", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.txt", "abc\n")));
        const app = TestApp.createWithContent(ctrl.view, new Size(20, 3));
        ctrl.focusEditor();
        app.render();
        expect(app.backend.cursorStyle).toBeNull();
        expect(ctrl.view.isLayoutDirty).toBe(false);

        ctrl.setCursorStyle({ shape: "bar", blinking: true });
        // The setter schedules the repaint itself: nothing else changed in the editor.
        expect(ctrl.view.isLayoutDirty).toBe(true);
        app.render();
        expect(app.backend.cursorStyle).toEqual({ shape: "bar", blinking: true });

        ctrl.setCursorStyle({ shape: "bar", blinking: true });
        expect(ctrl.view.isLayoutDirty).toBe(false);
    });
});
