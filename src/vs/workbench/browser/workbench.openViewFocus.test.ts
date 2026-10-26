import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { SEARCH_VIEW_ID } from "../contrib/search/browser/searchComponent.ts";

import { ViewsServiceDIToken } from "./parts/views/viewsService.ts";

/**
 * Upstream `viewsService.openView(id, focus)` in the sidebar: `focus: false` (an extension tree's
 * `reveal(item, { focus: false })`) shows the section and leaves the keyboard where it was.
 */
describe("Workbench — openView of a sidebar view and the keyboard focus", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-openview-", files: { "a.txt": "hello" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            focusEditor: true,
            size: new Size(100, 24),
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function frame(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    it("without focus the sidebar switches to the view, and typing still lands in the editor", () => {
        expect(frame()).not.toContain("SEARCH");

        h.container.get(ViewsServiceDIToken).openView(SEARCH_VIEW_ID, false);

        expect(frame()).toContain("SEARCH");
        expect(h.testApp.focusedElement?.constructor.name).toBe("EditorElement");
        h.testApp.sendKey("Q");
        expect(frame()).toContain("Qhello");
    });

    it("with focus the view takes the keyboard", () => {
        h.container.get(ViewsServiceDIToken).openView(SEARCH_VIEW_ID, true);

        expect(frame()).toContain("SEARCH");
        expect(h.testApp.focusedElement?.constructor.name).not.toBe("EditorElement");
    });
});
