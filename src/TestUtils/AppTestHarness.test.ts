import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "./AppTestHarness.ts";
import { tabLabels } from "./domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "./TempWorkspace.ts";

describe("createAppTestHarness", () => {
    let ws: ITempWorkspace | undefined;
    let h: IAppHarness | undefined;

    afterEach(() => {
        h?.dispose();
        ws?.dispose();
        h = undefined;
        ws = undefined;
    });

    it("boots the controller with a workspace, opens a file and focuses the editor", () => {
        ws = createTempWorkspace({ files: { "alpha.txt": "Alpha content" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("alpha.txt"),
            focusEditor: true,
        });

        expect(tabLabels(h.testApp)).toEqual(["alpha.txt"]);
        expect(h.activeEditor()).toBeDefined();
        expect(h.commands.has("workbench.action.files.openFile")).toBe(true);
    });

    it("boots without a workspace with a custom terminal size", () => {
        h = createAppTestHarness({ size: new Size(100, 30) });

        expect(h.testApp.backend.getSize()).toEqual(new Size(100, 30));
        expect(tabLabels(h.testApp)).toEqual([]);
    });

    it("exposes the container for suite-specific services", () => {
        h = createAppTestHarness();

        expect(h.container.get).toBeDefined();
        expect(h.workbench.view).toBe(h.testApp.root);
    });
});
