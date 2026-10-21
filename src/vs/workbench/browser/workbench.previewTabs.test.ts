import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { Uri } from "../../base/common/uri.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

function tabLabels(h: IAppHarness): string[] {
    const strip = h.testApp.querySelector("EditorTabStripElement") as EditorTabStripElement;
    return strip.getItemElements().map((item) => item.getLabel());
}

describe("Workbench: preview tabs from the tree", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function boot(configurationService?: IConfigurationService): void {
        h = createAppTestHarness({ workspaceFolder: ws.dir, configurationService });
    }

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-preview-tabs-",
            // Three files without directories: the tree sorts them alphabetically, and
            // ArrowDown steps exactly through them.
            files: {
                "alpha.txt": "Alpha",
                "beta.txt": "Beta",
                "gamma.txt": "Gamma",
            },
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    /** `index` is the file's zero-based position from the top. */
    async function activateInTree(index: number): Promise<void> {
        await h.workbench.activate();
        h.testApp.render();
        const tree = h.testApp.querySelector("TreeViewElement");
        if (tree === null) throw new Error("tree not found");
        tree.focus();
        h.testApp.render();
        for (let step = 0; step < index; step++) h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        h.testApp.render();
    }

    function activateAgainInTree(index: number): void {
        const tree = h.testApp.querySelector("TreeViewElement");
        if (tree === null) throw new Error("tree not found");
        tree.focus();
        h.testApp.render();
        // The tree's cursor stays from the previous activation — move it back to the start first.
        for (let step = 0; step < 10; step++) h.testApp.sendKey("ArrowUp");
        for (let step = 0; step < index; step++) h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        h.testApp.render();
    }

    it("walking the tree does not pile up tabs: the second file takes the first one's slot", async () => {
        boot();
        await activateInTree(0);
        expect(tabLabels(h)).toEqual(["alpha.txt"]);

        activateAgainInTree(1);

        expect(tabLabels(h)).toEqual(["beta.txt"]);
    });

    it("an edit pins the preview, so the next file opens beside it", async () => {
        boot();
        await activateInTree(0);

        h.testApp.sendKey("x");
        h.testApp.render();
        activateAgainInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
    });

    it("Ctrl+K Enter pins the preview without changing its content", async () => {
        boot();
        await activateInTree(0);

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Enter");
        h.testApp.render();
        activateAgainInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
        expect(h.activeEditor().getText()).toBe("Beta");
    });

    it("a pinned tab and the next preview coexist, and the preview gets replaced", async () => {
        boot();
        await activateInTree(0);
        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Enter");
        h.testApp.render();

        activateAgainInTree(1);
        activateAgainInTree(2);

        expect(tabLabels(h)).toEqual(["alpha.txt", "gamma.txt"]);
    });

    it("`workbench.openFile` without options (CLI, Quick Open) does not open a preview", async () => {
        boot();
        await activateInTree(0);

        // Exactly the call Quick Open and the CLI make — without `preview`.
        h.commands.execute("workbench.openFile", ws.path("beta.txt"));
        h.testApp.render();

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
    });

    it("replacing with `focus: false` does not move focus", async () => {
        boot();
        await activateInTree(0);
        const tree = h.testApp.querySelector("TreeViewElement");
        if (tree === null) throw new Error("tree not found");
        tree.focus();
        h.testApp.render();

        // `preserveFocus` of `showTextDocument` and reveals relies on this.
        await h.container.get(EditorServiceDIToken).openUri(Uri.file(ws.path("beta.txt")), {
            preview: true,
            focus: false,
        });
        h.testApp.render();

        expect(tabLabels(h)).toEqual(["beta.txt"]);
        expect(h.testApp.focusedElement).toBe(tree);
    });

    it("with the setting off the tree piles up tabs, as before the feature", async () => {
        boot(createTestConfigurationService({ "workbench.editor.enablePreview": false }));
        await activateInTree(0);

        activateAgainInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
    });
});
