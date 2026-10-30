import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { MenuId } from "../../platform/actions/common/menuId.ts";
import { MenuServiceDIToken } from "../../platform/actions/common/menuService.ts";
import { EXPLORER_VIEW_ID, EXPLORER_VIEWLET_ID } from "../contrib/files/browser/explorerComponent.ts";
import { OPEN_EDITORS_VIEW_ID } from "../contrib/files/browser/openEditorsView.ts";
import { EditorGroupsServiceDIToken } from "../services/editor/common/editorGroupsService.ts";

import { ViewsServiceDIToken } from "./parts/views/viewsService.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

describe("Workbench — Explorer: Open Editors", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-open-editors-", files: { "a.ts": "", "src/b.ts": "" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 30) });
        h.commands.execute("workbench.openFile", ws.path("a.ts"));
        h.commands.execute("workbench.openFile", ws.path("src/b.ts"));
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    async function frame(): Promise<string> {
        await new Promise((resolve) => setTimeout(resolve, 0));
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    it("the Explorer starts with the file tree alone; Open Editors waits unchecked in its menu", () => {
        const views = h.container.get(ViewsServiceDIToken);
        expect(views.getContainerViews(EXPLORER_VIEWLET_ID).map((view) => [view.id, view.visible])).toEqual([
            [OPEN_EDITORS_VIEW_ID, false],
            [EXPLORER_VIEW_ID, true],
        ]);
    });

    it("Explorer: Focus on Open Editors View shows the section above the files and focuses the list", async () => {
        h.commands.execute("workbench.files.action.focusOpenEditorsView");

        const screen = await frame();
        expect(screen).toContain("OPEN EDITORS");
        expect(screen.indexOf("OPEN EDITORS")).toBeLessThan(screen.indexOf("DIODE-OPEN"));
        expect(screen).toMatch(/b\.ts src/u);
        expect(h.testApp.app.focusManager?.activeElement?.id).toBe("openEditorsList");
    });

    it("Delete in the list closes the editor under the cursor", async () => {
        h.commands.execute("workbench.files.action.focusOpenEditorsView");
        await frame();
        h.container.get(WorkbenchContextKeysDIToken).update();

        h.testApp.sendKey("Delete");

        await vi.waitFor(() => {
            expect(
                h.container
                    .get(EditorGroupsServiceDIToken)
                    .activeGroup.getPanes()
                    .map((p) => p.label),
            ).toEqual(["a.ts"]);
        });
    });

    it("the title shows Save All and Close All; Toggle Layout only with two groups", async () => {
        h.commands.execute("workbench.files.action.focusOpenEditorsView");
        const actions = (): string[] =>
            h.container
                .get(MenuServiceDIToken)
                .getEntryGroups(MenuId.ViewTitle, { view: OPEN_EDITORS_VIEW_ID })
                .filter((group) => group.group === "navigation")
                .flatMap((group) => group.entries)
                .map((entry) => ("label" in entry ? entry.label : ""));

        await frame();
        expect(actions()).toEqual(["Save All", "Close All Editors"]);

        h.commands.execute("workbench.action.splitEditor");
        h.container.get(WorkbenchContextKeysDIToken).update();
        await frame();
        expect(actions()).toEqual(["Toggle Vertical/Horizontal Editor Layout", "Save All", "Close All Editors"]);

        h.commands.execute("openEditors.closeAll");
        await vi.waitFor(() => {
            expect(h.container.get(EditorGroupsServiceDIToken).groups.flatMap((g) => g.getPanes())).toEqual([]);
        });
    });
});
