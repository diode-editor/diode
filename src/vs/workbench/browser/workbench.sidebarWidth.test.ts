import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkbenchLayoutElement } from "@tuidom/elements/workbenchlayout/workbenchLayoutElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

describe("Side Bar width commands", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-sidebar-", files: { "hello.txt": "hello world" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function layout(): WorkbenchLayoutElement {
        const el = h.testApp.querySelector("WorkbenchLayoutElement");
        expect(el).not.toBeNull();
        return el as WorkbenchLayoutElement;
    }

    it("increase grows the sidebar by the step", () => {
        const before = layout().getLeftPanelWidth();
        h.commands.execute("workbench.action.increaseSidebarWidth");
        expect(layout().getLeftPanelWidth()).toBe(before + 3);
    });

    it("decrease shrinks the sidebar by the step", () => {
        const before = layout().getLeftPanelWidth();
        h.commands.execute("workbench.action.decreaseSidebarWidth");
        expect(layout().getLeftPanelWidth()).toBe(before - 3);
    });

    it("reset restores the default width", () => {
        h.commands.execute("workbench.action.increaseSidebarWidth");
        h.commands.execute("workbench.action.increaseSidebarWidth");
        h.commands.execute("workbench.action.resetSidebarWidth");
        expect(layout().getLeftPanelWidth()).toBe(30);
    });

    it("decrease clamps at the minimum width", () => {
        for (let i = 0; i < 20; i++) {
            h.commands.execute("workbench.action.decreaseSidebarWidth");
        }
        expect(layout().getLeftPanelWidth()).toBe(12);
    });
});
