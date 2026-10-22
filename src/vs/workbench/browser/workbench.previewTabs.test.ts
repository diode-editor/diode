import { MouseEventDispatcher } from "@tuidom/core/dom/events/mouseEventDispatcher";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
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

/** Which tabs the strip draws as previews (italic label). */
function previewMarks(h: IAppHarness): boolean[] {
    const strip = h.testApp.querySelector("EditorTabStripElement") as EditorTabStripElement;
    return strip.getItemElements().map((item) => item.getPreview());
}

function mouse(action: MouseToken["action"], x: number, y: number, button: MouseToken["button"]): MouseToken {
    // Terminal tokens are 1-based.
    return {
        kind: "mouse",
        button,
        action,
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

describe("Workbench: preview tabs from the tree", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    /** One dispatcher per test: it pairs two clicks on the same cell into a double click. */
    let dispatcher: MouseEventDispatcher;
    let now: number;

    function boot(configurationService?: IConfigurationService): void {
        h = createAppTestHarness({ workspaceFolder: ws.dir, configurationService });
    }

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-preview-tabs-",
            // Three files without directories: the tree sorts them alphabetically, one per row.
            files: {
                "alpha.txt": "Alpha",
                "beta.txt": "Beta",
                "gamma.txt": "Gamma",
            },
        });
        now = 0;
        dispatcher = new MouseEventDispatcher(() => now);
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    async function treeView(): Promise<TUIElement> {
        await h.workbench.activate();
        h.testApp.render();
        const tree = h.testApp.querySelector("TreeViewElement");
        if (tree === null) throw new Error("tree not found");
        return tree;
    }

    /**
     * A real click through the engine's dispatcher on the `index`-th file, as the terminal delivers it.
     * Clicks are far apart in time unless `quick`: two quick ones on the same cell are a double click.
     */
    async function clickInTree(index: number, button: MouseToken["button"] = "left", quick = false): Promise<void> {
        const tree = await treeView();
        if (!quick) now += 10_000;
        const x = tree.globalPosition.x + 3;
        const y = tree.globalPosition.y + index;
        dispatcher.handleMouseToken(mouse("press", x, y, button), h.testApp.root);
        dispatcher.handleMouseToken(mouse("release", x, y, button), h.testApp.root);
        h.testApp.render();
    }

    async function doubleClickInTree(index: number): Promise<void> {
        await clickInTree(index);
        await clickInTree(index, "left", true);
    }

    function keepEditor(): void {
        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Enter");
        h.testApp.render();
    }

    it("walking the tree by clicks does not pile up tabs: the second file takes the first one's slot", async () => {
        boot();
        await clickInTree(0);
        expect(tabLabels(h)).toEqual(["alpha.txt"]);

        await clickInTree(1);

        expect(tabLabels(h)).toEqual(["beta.txt"]);
        expect(h.activeEditor().getText()).toBe("Beta");
    });

    it("a click keeps focus in the tree, so the arrows keep walking it without opening anything", async () => {
        boot();
        const tree = await treeView();
        tree.focus();
        await clickInTree(0);

        expect(h.testApp.focusedElement).toBe(tree);
        h.testApp.sendKey("ArrowDown");
        h.testApp.render();
        expect(tabLabels(h)).toEqual(["alpha.txt"]);
    });

    it("a double click opens the file pinned and focuses the editor", async () => {
        boot();
        await doubleClickInTree(0);
        expect(tabLabels(h)).toEqual(["alpha.txt"]);
        expect(h.testApp.focusedElement).not.toBe(await treeView());

        await clickInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
    });

    it("a double click pins the preview the first click opened, in its slot", async () => {
        boot();
        await clickInTree(2);
        await clickInTree(0);
        expect(tabLabels(h)).toEqual(["alpha.txt"]);

        await doubleClickInTree(1);
        await clickInTree(2);

        expect(tabLabels(h)).toEqual(["beta.txt", "gamma.txt"]);
    });

    it("Enter opens the file pinned, as upstream `list.select`", async () => {
        boot();
        const tree = await treeView();
        tree.focus();
        h.testApp.sendKey("Enter");
        h.testApp.render();

        await clickInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
    });

    it("a middle click opens the file pinned", async () => {
        boot();
        await clickInTree(0, "middle");

        await clickInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
    });

    it("an edit pins the preview, so the next file opens beside it", async () => {
        boot();
        await clickInTree(0);

        h.activeEditor().focusEditor();
        h.testApp.sendKey("x");
        h.testApp.render();
        await clickInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
    });

    it("Ctrl+K Enter pins the preview without changing its content", async () => {
        boot();
        await clickInTree(0);

        keepEditor();
        await clickInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
        expect(h.activeEditor().getText()).toBe("Beta");
    });

    it("a pinned tab and the next preview coexist, and the preview gets replaced", async () => {
        boot();
        await clickInTree(0);
        keepEditor();

        await clickInTree(1);
        await clickInTree(2);

        expect(tabLabels(h)).toEqual(["alpha.txt", "gamma.txt"]);
    });

    it("the strip marks only the preview tab, and pinning clears the mark", async () => {
        boot();
        await clickInTree(0);
        keepEditor();
        await clickInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
        expect(previewMarks(h)).toEqual([false, true]);

        h.activeEditor().focusEditor();
        h.testApp.sendKey("x");
        h.testApp.render();

        expect(previewMarks(h)).toEqual([false, false]);
    });

    it("`workbench.openFile` without options (CLI, Quick Open) does not open a preview", async () => {
        boot();
        await clickInTree(0);

        // Exactly the call Quick Open and the CLI make — without `preview`.
        h.commands.execute("workbench.openFile", ws.path("beta.txt"));
        h.testApp.render();

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
    });

    it("replacing with `focus: false` does not move focus", async () => {
        boot();
        await clickInTree(0);
        const tree = await treeView();
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

    it("with `workbench.list.openMode: doubleClick` a click only selects, a double click opens", async () => {
        boot(createTestConfigurationService({ "workbench.list.openMode": "doubleClick" }));
        await clickInTree(0);
        expect(tabLabels(h)).toEqual([]);

        await doubleClickInTree(1);

        expect(tabLabels(h)).toEqual(["beta.txt"]);
    });

    it("with previews off the tree piles up tabs, as before the feature", async () => {
        boot(createTestConfigurationService({ "workbench.editor.enablePreview": false }));
        await clickInTree(0);

        await clickInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
        expect(previewMarks(h)).toEqual([false, false]);
    });
});
