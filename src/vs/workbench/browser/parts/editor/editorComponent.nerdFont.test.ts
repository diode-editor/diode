import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import { Uri } from "../../../../base/common/uri.ts";

describe("EditorComponent — setNerdFont", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-editor-nerdfont-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("redraws the folding chevron in the new glyph set", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.txt", "block\n  a\ntail")));
        ctrl.viewState.foldRegionContaining(0);
        const app = TestApp.createWithContent(ctrl.view, new Size(20, 3));
        app.render();
        // Gutter: 2 pad + 1 digit + the change bar column, then the chevron.
        const chevron = new Point(4, 0);
        expect(app.backend.getTextAt(chevron, 1)).toBe(codicon("chevron-right").nerdFont);
        expect(ctrl.view.isLayoutDirty).toBe(false);

        ctrl.setNerdFont(false);
        // The setter schedules the repaint itself: nothing else changed in the editor.
        expect(ctrl.view.isLayoutDirty).toBe(true);
        app.render();
        expect(app.backend.getTextAt(chevron, 1)).toBe("▸");

        ctrl.setNerdFont(false);
        expect(ctrl.view.isLayoutDirty).toBe(false);
    });
});
