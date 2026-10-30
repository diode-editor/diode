import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { fileDialogDriver } from "../../../TestUtils/fileDialogDriver.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { MenuId } from "../../platform/actions/common/menuId.ts";
import { MenuServiceDIToken } from "../../platform/actions/common/menuService.ts";
import { EditorGroupsServiceDIToken } from "../services/editor/common/editorGroupsService.ts";

/** Upstream `workbench.action.files.saveAll` and the Open Editors group row's `saveAllInGroup`. */
describe("Workbench — Save All", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-saveall-",
            files: { "alpha.txt": "alpha", "beta.txt": "beta", "gamma.txt": "gamma" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function edit(file: string): void {
        h.commands.execute("workbench.openFile", ws.path(file));
        h.activeEditor().viewState.type("X");
    }

    it("saves every modified editor of every group", async () => {
        edit("alpha.txt");
        h.commands.execute("workbench.action.splitEditor");
        edit("beta.txt");

        h.commands.execute("workbench.action.files.saveAll");

        await vi.waitFor(() => {
            expect(fs.readFileSync(ws.path("alpha.txt"), "utf-8")).toBe("Xalpha");
            expect(fs.readFileSync(ws.path("beta.txt"), "utf-8")).toBe("Xbeta");
        });
        expect(fs.readFileSync(ws.path("gamma.txt"), "utf-8")).toBe("gamma");
    });

    it("an untitled buffer goes through the Save As dialog, like Ctrl+S", async () => {
        edit("alpha.txt");
        h.commands.execute("workbench.action.files.newUntitledFile");
        h.activeEditor().viewState.type("draft");
        const dialog = fileDialogDriver(h);

        h.commands.execute("workbench.action.files.saveAll");

        await vi.waitFor(() => {
            expect(fs.readFileSync(ws.path("alpha.txt"), "utf-8")).toBe("Xalpha");
        });
        // The folder listing loads asynchronously and would reset a query typed before it arrives.
        await dialog.settle({ title: "Save As", items: ["..", "alpha.txt", "beta.txt", "gamma.txt"] });
        const target = ws.path("draft.txt");
        dialog.replaceQuery(target);
        await dialog.settle({ query: target });
        dialog.key("Enter");
        await vi.waitFor(() => {
            expect(fs.readFileSync(target, "utf-8")).toBe("draft");
        });
    });

    it("Save All in Group saves only that group's editors", async () => {
        // The split copies alpha into the second group (one model): only the first group lacks beta.
        edit("alpha.txt");
        h.commands.execute("workbench.action.splitEditor");
        edit("beta.txt");
        const [first, second] = h.container.get(EditorGroupsServiceDIToken).groups;

        // An unknown group (closed meanwhile) saves nothing.
        await h.commands.execute("workbench.files.action.saveAllInGroup", -1);
        h.commands.execute("workbench.files.action.saveAllInGroup", first.id);
        await vi.waitFor(() => {
            expect(fs.readFileSync(ws.path("alpha.txt"), "utf-8")).toBe("Xalpha");
        });
        expect(fs.readFileSync(ws.path("beta.txt"), "utf-8")).toBe("beta");

        h.commands.execute("workbench.files.action.saveAllInGroup", second.id);
        await vi.waitFor(() => {
            expect(fs.readFileSync(ws.path("beta.txt"), "utf-8")).toBe("Xbeta");
        });
    });

    it("File menu: Save All right after Save As", () => {
        const labels = h.container
            .get(MenuServiceDIToken)
            .getEntries(MenuId.MenubarFileMenu)
            .map((entry) => ("label" in entry ? entry.label : ""));
        expect(labels.slice(labels.indexOf("Save As..."), labels.indexOf("Save As...") + 2)).toEqual([
            "Save As...",
            "Save All",
        ]);
    });
});
