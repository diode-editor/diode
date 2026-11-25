import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";

const BAR = "┃"; // solid change bar (no dashed flag on this decoration)
const CHANGE_COLOR = packRgb(0x1b, 0x81, 0xa8);
const OTHER_COLOR = packRgb(0x48, 0x75, 0x23);

describe("EditorComponent — setGutterChangeDecorations", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-gutterchange-" });
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

    it("an extension's scrollbar marks draw no bar in the gutter and leave the quick diff bars alone", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.txt", "l0\nl1\nl2")));
        const app = TestApp.createWithContent(ctrl.view, new Size(20, 3));
        const x = 3;

        ctrl.setGutterChangeDecorations([{ range: createRange(0, 0, 0, 0), color: CHANGE_COLOR }]);
        app.render();
        expect(ctrl.view.isLayoutDirty).toBe(false);
        ctrl.setOverviewRulerDecorations([{ range: createRange(2, 0, 2, 0), color: OTHER_COLOR }]);
        expect(ctrl.view.isLayoutDirty).toBe(true);
        app.render();
        expect(app.backend.getTextAt(new Point(x, 0), 1)).toBe(BAR);
        expect(app.backend.getFgAt(new Point(x, 0))).toBe(CHANGE_COLOR);
        expect(app.backend.getTextAt(new Point(x, 2), 1)).not.toBe(BAR);

        // An extension clears its marks on every keystroke — the git bar must survive.
        ctrl.setOverviewRulerDecorations([]);
        app.render();
        expect(app.backend.getTextAt(new Point(x, 0), 1)).toBe(BAR);
        expect(app.backend.getFgAt(new Point(x, 0))).toBe(CHANGE_COLOR);
    });
});
