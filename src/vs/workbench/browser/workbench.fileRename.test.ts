import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Point } from "../../../../tuidom/common/geometryPromitives.ts";
import { TUIContextMenuEvent, TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import type { QuickPickElement } from "../../../../tuidom/ui/quickpick/quickPickElement.ts";
import type { TreeViewElement } from "../../../../tuidom/ui/tree/treeViewElement.ts";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { quickPickByTitle } from "../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";

/** runRename awaits the QuickInput promise, then refresh → reveal; drain enough turns. */
const FLUSH_TURNS = 20;

/** Simulate typing into an InputBox: set the value AND revalidate (setQuery alone doesn't). */
function typeInto(input: QuickPickElement, text: string): void {
    input.setQuery(text);
    input.onQueryChange?.(text);
}

describe("Workbench — Rename", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-rename-", files: { "old.txt": "hi" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("prompts pre-filled with the current basename and renames the file in place", async () => {
        h.commands.execute("fileOperations.rename", ws.path("old.txt"));
        h.testApp.render();

        const input = quickPickByTitle(h.testApp, "Rename");
        expect(input.getQuery()).toBe("old.txt"); // seeded with the current name

        typeInto(input, "new.txt");
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.existsSync(ws.path("old.txt"))).toBe(false);
        expect(fs.readFileSync(ws.path("new.txt"), "utf-8")).toBe("hi");
    });

    it("renames a directory in place", async () => {
        ws.writeFile(path.join("dir", "inside.txt"), "x");
        h.commands.execute("fileOperations.rename", ws.path("dir"));
        h.testApp.render();

        typeInto(quickPickByTitle(h.testApp, "Rename"), "renamed");
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.existsSync(ws.path("dir"))).toBe(false);
        expect(fs.readFileSync(path.join(ws.dir, "renamed", "inside.txt"), "utf-8")).toBe("x");
    });

    it("is a no-op when the name is unchanged", async () => {
        h.commands.execute("fileOperations.rename", ws.path("old.txt"));
        h.testApp.render();

        // Accept the pre-filled name as-is → runRename returns before touching disk.
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.readFileSync(ws.path("old.txt"), "utf-8")).toBe("hi");
    });

    it("validates the new name", () => {
        ws.writeFile("taken.txt", "x");
        h.commands.execute("fileOperations.rename", ws.path("old.txt"));
        h.testApp.render();
        const input = quickPickByTitle(h.testApp, "Rename");

        input.onQueryChange?.("   ");
        expect(input.validationMessage).toBe("Please enter a name");

        input.onQueryChange?.("..");
        expect(input.validationMessage).toBe("Invalid name");

        input.onQueryChange?.(path.join(os.tmpdir(), "abs.txt"));
        expect(input.validationMessage).toBe("Please enter a relative name");

        input.onQueryChange?.("taken.txt");
        expect(input.validationMessage).toBe("A file or folder with that name already exists");

        input.onQueryChange?.("old.txt"); // unchanged name is valid (handled as a no-op)
        expect(input.validationMessage).toBeNull();

        input.onQueryChange?.("fresh.txt");
        expect(input.validationMessage).toBeNull();
    });

    it("Escape cancels without renaming", async () => {
        h.commands.execute("fileOperations.rename", ws.path("old.txt"));
        h.testApp.render();

        typeInto(quickPickByTitle(h.testApp, "Rename"), "ghost.txt");
        h.testApp.sendKey("Escape");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.existsSync(ws.path("old.txt"))).toBe(true);
        expect(fs.existsSync(ws.path("ghost.txt"))).toBe(false);
    });

    it("falls back to the selected tree path when invoked without an argument", async () => {
        await h.workbench.activate();
        h.testApp.render();
        // Focus the tree: its cursor lands on the only entry (old.txt), which becomes
        // the selected path getSelectedPaths()[0] returns when rename gets no argument.
        h.testApp.querySelector("TreeViewElement")!.focus();
        h.testApp.render();

        h.commands.execute("fileOperations.rename");
        h.testApp.render();

        typeInto(quickPickByTitle(h.testApp, "Rename"), "picked.txt");
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.existsSync(ws.path("picked.txt"))).toBe(true);
    });

    it("does nothing when neither an argument nor a selection is available", () => {
        // No workspace → empty tree → getSelectedPaths() is empty → no prompt.
        const bare = createAppTestHarness();
        bare.commands.execute("fileOperations.rename");
        bare.testApp.render();

        const hasPrompt = (bare.testApp.querySelectorAll("QuickPickElement") as QuickPickElement[]).some(
            (p) => p.title === "Rename",
        );
        expect(hasPrompt).toBe(false);
        bare.dispose();
    });
});

describe("Workbench — Rename via context menu", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "vexx-rename-menu-", files: { "alpha.txt": "a" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("Rename... entry prompts and renames the clicked file", async () => {
        const tree = h.testApp.querySelector("TreeViewElement") as TreeViewElement<unknown>;
        tree.focus();
        h.testApp.render();

        // Right-click the file row (row 0) to open its context menu.
        tree.globalPosition = new Point(0, 0);
        tree.dispatchEvent(
            new TUIContextMenuEvent({ trigger: "mouse", button: "right", screenX: 2, screenY: 0, localX: 2, localY: 0 }),
        );
        h.testApp.render();
        expect(h.testApp.querySelector("PopupMenuElement")).not.toBeNull();

        // Clipboard is empty (no Paste), so the order is New File, New Folder, (sep),
        // Copy, Cut, (sep), Copy Path, Copy Relative Path, (sep), Rename — six
        // ArrowDowns land on Rename (separators are skipped).
        for (let i = 0; i < 6; i++) h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        h.testApp.render();

        expect(h.testApp.querySelector("PopupMenuElement")).toBeNull();

        typeInto(quickPickByTitle(h.testApp, "Rename"), "beta.txt");
        h.testApp.sendKey("Enter");
        await flushMicrotasks(FLUSH_TURNS);
        h.testApp.render();

        expect(fs.existsSync(ws.path("beta.txt"))).toBe(true);
        expect(fs.existsSync(ws.path("alpha.txt"))).toBe(false);
    });
});
