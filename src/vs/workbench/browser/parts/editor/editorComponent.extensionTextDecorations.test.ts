import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";

const PAINT = packRgb(0x80, 0x10, 0x10);

describe("EditorComponent — setExtensionTextDecorations", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-exttextdeco-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("[api:TextEditor.setDecorations] a set reaches the frame with a repaint, an empty set clears it", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.txt", "alpha   \nbeta")));
        const app = TestApp.createWithContent(ctrl.view, new Size(20, 3));
        app.render();
        const rowBgs = () => Array.from({ length: 20 }, (_, x) => app.backend.getBgAt(new Point(x, 0)));
        const editorBg = app.backend.getBgAt(new Point(19, 0));
        expect(ctrl.view.isLayoutDirty).toBe(false);

        ctrl.setExtensionTextDecorations([{ range: createRange(0, 5, 0, 8), bg: PAINT, isWholeLine: false }]);
        expect(ctrl.view.isLayoutDirty).toBe(true);
        app.render();

        expect(rowBgs().filter((bg) => bg === PAINT)).toHaveLength(3);

        ctrl.setExtensionTextDecorations([]);
        app.render();
        expect(rowBgs()).not.toContain(PAINT);
        expect(app.backend.getBgAt(new Point(19, 0))).toBe(editorBg);
    });
});
