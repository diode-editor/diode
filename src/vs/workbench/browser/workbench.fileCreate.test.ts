import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Offset, Point } from "@tuidom/all/common/geometryPromitives";
import { TUIContextMenuEvent, TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import type { QuickPickElement } from "@tuidom/all/ui/quickpick/quickPickElement";
import type { TreeViewElement } from "@tuidom/all/ui/tree/treeViewElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { quickPickByTitle, tabLabels } from "../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";

/**
 * The create/Save-As handlers await the QuickInput promise and then several more
 * awaits (refresh → reveal → open); flush enough microtask turns to drain them.
 */
const FLUSH_TURNS = 20;

/** Simulate typing into an InputBox: set the value AND revalidate (setQuery alone doesn't). */
function typeInto(input: QuickPickElement, text: string): void {
    input.setQuery(text);
    input.onQueryChange?.(text);
}

describe("Workbench — New File / New Folder", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-create-" });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("creates a file, reveals it, and opens it in the editor", async () => {
        h.commands.execute("explorer.newFile", ws.dir);
        h.testApp.render();

        typeInto(quickPickByTitle(h.testApp, "New File"), "hello.ts");
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        const created = ws.path("hello.ts");
        expect(fs.readFileSync(created, "utf-8")).toBe("");
        expect(tabLabels(h.testApp).some((l) => l.includes("hello.ts"))).toBe(true);
    });

    it("creates a file next to a clicked file (target is the file's parent dir)", async () => {
        const clicked = ws.writeFile("alpha.txt", "x");
        h.commands.execute("explorer.newFile", clicked);
        h.testApp.render();

        typeInto(quickPickByTitle(h.testApp, "New File"), "beside.ts");
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.existsSync(ws.path("beside.ts"))).toBe(true);
    });

    it("falls back to the tree's paste-target dir when invoked without a path", async () => {
        h.commands.execute("explorer.newFile"); // no explorer path → getPasteTargetDir() (root)
        h.testApp.render();

        typeInto(quickPickByTitle(h.testApp, "New File"), "from-palette.ts");
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.existsSync(ws.path("from-palette.ts"))).toBe(true);
    });

    it("creates a folder without opening an editor", async () => {
        h.commands.execute("explorer.newFolder", ws.dir);
        h.testApp.render();

        typeInto(quickPickByTitle(h.testApp, "New Folder"), "assets");
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.statSync(ws.path("assets")).isDirectory()).toBe(true);
        expect(tabLabels(h.testApp)).toEqual([]);
    });

    it("creates intermediate directories for a nested file name", async () => {
        h.commands.execute("explorer.newFile", ws.dir);
        h.testApp.render();

        typeInto(quickPickByTitle(h.testApp, "New File"), path.join("sub", "dir", "note.md"));
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.existsSync(path.join(ws.dir, "sub", "dir", "note.md"))).toBe(true);
    });

    it("validates the name", () => {
        ws.writeFile("taken.txt", "x");
        h.commands.execute("explorer.newFile", ws.dir);
        h.testApp.render();
        const input = quickPickByTitle(h.testApp, "New File");

        input.onQueryChange?.("   ");
        expect(input.validationMessage).toBe("Please enter a name");

        input.onQueryChange?.("..");
        expect(input.validationMessage).toBe("Invalid name");

        input.onQueryChange?.(path.join(os.tmpdir(), "abs.txt"));
        expect(input.validationMessage).toBe("Please enter a relative name");

        input.onQueryChange?.("taken.txt");
        expect(input.validationMessage).toBe("A file or folder with that name already exists");

        input.onQueryChange?.("fresh.txt");
        expect(input.validationMessage).toBeNull();
    });

    it("Escape cancels without creating anything", async () => {
        h.commands.execute("explorer.newFile", ws.dir);
        h.testApp.render();

        typeInto(quickPickByTitle(h.testApp, "New File"), "ghost.txt");
        h.testApp.sendKey("Escape");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.existsSync(ws.path("ghost.txt"))).toBe(false);
    });
});

describe("Workbench — New Untitled File", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-untitled-" });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("opens an Untitled-1 tab", () => {
        h.commands.execute("workbench.action.files.newUntitledFile");
        h.testApp.render();
        expect(tabLabels(h.testApp)).toEqual(["Untitled-1"]);
    });

    it("routes Save on an untitled buffer into Save As and writes the chosen path", async () => {
        h.commands.execute("workbench.action.files.newUntitledFile");
        h.testApp.render();

        h.commands.execute("workbench.action.files.save");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        // No path yet → runSave falls through to Save As, which pops its InputBox.
        const saveAs = (h.testApp.querySelectorAll("QuickPickElement") as QuickPickElement[]).find(
            (p) => p.title === "Save As",
        );
        expect(saveAs).toBeDefined();

        // Complete the Save As so runSave's no-file branch returns.
        const target = ws.path("saved-untitled.txt");
        saveAs!.setQuery(target);
        saveAs!.onQueryChange?.(target);
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.existsSync(target)).toBe(true);
        expect(tabLabels(h.testApp)).toContain("saved-untitled.txt");
    });
});

describe("Workbench — create via context menu", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "vexx-create-menu-", files: { "alpha.txt": "a" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function openMenuOnRoot(): void {
        const tree = h.testApp.querySelector("TreeViewElement") as TreeViewElement<unknown>;
        tree.focus();
        h.testApp.render();
        tree.localPosition = new Offset(0, 0);
        tree.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "mouse",
                button: "right",
                screenX: 2,
                screenY: 0,
                localX: 2,
                localY: 0,
            }),
        );
        h.testApp.render();
    }

    it("New File... entry prompts and creates a file", async () => {
        openMenuOnRoot();
        h.testApp.sendKey("Enter"); // first entry: New File...
        h.testApp.render();

        typeInto(quickPickByTitle(h.testApp, "New File"), "menu-file.ts");
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.existsSync(ws.path("menu-file.ts"))).toBe(true);
    });

    it("no-ops when there is no target directory (no workspace, no path)", () => {
        // Deliberately no workspaceFolder → getPasteTargetDir() is null.
        const bare = createAppTestHarness();

        bare.commands.execute("explorer.newFile"); // no path + no workspace → targetDir null → early return
        bare.testApp.render();

        const hasPrompt = (bare.testApp.querySelectorAll("QuickPickElement") as QuickPickElement[]).some(
            (p) => p.title === "New File",
        );
        expect(hasPrompt).toBe(false);
        bare.dispose();
    });

    it("New Folder... entry prompts and creates a folder", async () => {
        openMenuOnRoot();
        h.testApp.sendKey("ArrowDown"); // second entry: New Folder...
        h.testApp.sendKey("Enter");
        h.testApp.render();

        typeInto(quickPickByTitle(h.testApp, "New Folder"), "menu-folder");
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.statSync(ws.path("menu-folder")).isDirectory()).toBe(true);
    });
});
