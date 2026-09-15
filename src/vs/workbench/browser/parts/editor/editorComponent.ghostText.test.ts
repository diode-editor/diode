import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";

describe("EditorComponent/TextEditorPane — setGhostText", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-ghosttext-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("проброс pane → component → element: ghost рисуется и снимается", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.ts", "const x = 1")));

        const app = TestApp.createWithContent(ctrl.view, new Size(30, 3));
        app.render();

        ctrl.setGhostText({ line: 0, character: 11, lines: [" + 2;"] });
        app.render();

        // Гуттер: 2 паддинга + 1 цифра + fold-маржин (3) = 6; хвост с колонки 11.
        const gutterW = 6;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 16)).toBe("const x = 1 + 2;");

        ctrl.setGhostText(null);
        app.render();
        expect(app.backend.getTextAt(new Point(gutterW, 0), 16)).toBe("const x = 1     ");
    });
});
