import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";

describe("EditorComponent — setInlineInsertions", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-insertions-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("pass-through component → element: insertions are drawn and removed", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.css", "a { color: #fff; }")));

        const app = TestApp.createWithContent(ctrl.view, new Size(30, 3));
        app.render();

        ctrl.component.setInlineInsertions([{ line: 0, offset: 11, text: "■ " }]);
        app.render();

        // Gutter: 2 padding + 1 digit + fold margin (3) = 6.
        const gutterW = 6;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 20)).toBe("a { color: ■ #fff; }");

        ctrl.component.setInlineInsertions([]);
        app.render();
        expect(app.backend.getTextAt(new Point(gutterW, 0), 20)).toBe("a { color: #fff; }  ");
    });
});
