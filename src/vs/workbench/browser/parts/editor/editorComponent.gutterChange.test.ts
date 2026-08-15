import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";

const BAR = "┃"; // solid change bar (no dashed flag on this decoration)
const CHANGE_COLOR = packRgb(0x1b, 0x81, 0xa8);

describe("EditorComponent — setGutterChangeDecorations", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-gutterchange-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("forwards decorations to the editor so a bar paints, and marks it dirty for a repaint", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.txt", "l0\nl1\nl2")));

        const app = TestApp.createWithContent(ctrl.view, new Size(20, 3));
        app.render();
        // Layout is clean after the initial paint — the setter must mark it dirty
        // again so the app schedules a repaint.
        expect(ctrl.view.isLayoutDirty).toBe(false);

        ctrl.setGutterChangeDecorations([{ range: createRange(1, 0, 1, 0), color: CHANGE_COLOR }]);
        expect(ctrl.view.isLayoutDirty).toBe(true);

        app.render();
        // Bar lives in the fold margin, one column left of the chevron: gutter is
        // 2 pad + 1 digit + fold margin, so the bar sits at column 3.
        const x = 3;
        expect(app.backend.getTextAt(new Point(x, 1), 1)).toBe(BAR);
        expect(app.backend.getFgAt(new Point(x, 1))).toBe(CHANGE_COLOR);
    });
});
