import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Offset, Point } from "../../../../tuidom/common/geometryPromitives.ts";
import { TUIContextMenuEvent, TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import type { TreeViewElement } from "../../../../tuidom/ui/tree/treeViewElement.ts";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { IClipboard } from "../../platform/clipboard/common/iClipboard.ts";
import { ClipboardDIToken } from "../common/coreTokens.ts";

// Workspace layout (dirs sort first): row 0 = "target/", row 1 = "a.txt".
function createWorkspace(): ITempWorkspace {
    const ws = createTempWorkspace({ prefix: "vexx-fileclip-int-", files: { "a.txt": "hello" } });
    fs.mkdirSync(ws.path("target"));
    return ws;
}

describe("File explorer copy/cut/paste commands", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createWorkspace();
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        h.testApp.render();
        h.testApp.querySelector("TreeViewElement")!.focus();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("copies a file into a folder, leaving the original", () => {
        h.testApp.sendKey("ArrowDown"); // cursor on a.txt
        h.commands.execute("fileOperations.copy");
        h.testApp.sendKey("ArrowUp"); // cursor on target/
        h.commands.execute("fileOperations.paste");

        expect(fs.existsSync(path.join(ws.dir, "target", "a.txt"))).toBe(true);
        expect(fs.existsSync(ws.path("a.txt"))).toBe(true);
    });

    it("cuts a file into a folder, removing the original and clearing the clipboard", () => {
        h.testApp.sendKey("ArrowDown"); // cursor on a.txt
        h.commands.execute("fileOperations.cut");
        h.testApp.sendKey("ArrowUp"); // cursor on target/
        h.commands.execute("fileOperations.paste");

        expect(fs.existsSync(path.join(ws.dir, "target", "a.txt"))).toBe(true);
        expect(fs.existsSync(ws.path("a.txt"))).toBe(false);

        // Pasting again is a no-op because the cut cleared the clipboard.
        h.commands.execute("fileOperations.paste");
        expect(fs.existsSync(path.join(ws.dir, "target", "a copy.txt"))).toBe(false);
    });

    it("auto-renames when pasting a copy alongside the original", () => {
        h.testApp.sendKey("ArrowDown"); // cursor on a.txt
        h.commands.execute("fileOperations.copy");
        // cursor stays on a.txt → target dir is the workspace root, where a.txt already exists
        h.commands.execute("fileOperations.paste");

        expect(fs.existsSync(ws.path("a copy.txt"))).toBe(true);
    });
});

describe("File explorer context menu — clipboard entries", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let clipboard: IClipboard;

    beforeEach(async () => {
        ws = createWorkspace();
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        clipboard = h.container.get(ClipboardDIToken);
        await h.workbench.activate();
        h.testApp.render();
        h.testApp.querySelector("TreeViewElement")!.focus();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    // Порядок пунктов: New File, New Folder, (sep), Copy, Cut, [Paste — если буфер
    // не пуст], (sep), Copy Path, Copy Relative Path, (sep), Delete.
    function rightClickRow(row: number): void {
        clickTree(row, "right");
    }

    function clickRow(row: number): void {
        clickTree(row, "left");
    }

    function clickTree(row: number, button: "left" | "right"): void {
        const tree = h.testApp.querySelector("TreeViewElement") as TreeViewElement<unknown>;
        tree.localPosition = new Offset(0, 0);
        const init = { screenX: 2, screenY: row, localX: 2, localY: row };
        if (button === "right") {
            // Правый клик — событие contextmenu (движок диспатчит его на release).
            tree.dispatchEvent(new TUIContextMenuEvent({ trigger: "mouse", button, ...init }));
        } else {
            tree.dispatchEvent(new TUIMouseEvent("click", { button, ...init }));
        }
        h.testApp.render();
    }

    it("Copy entry puts the clicked file on the clipboard", () => {
        rightClickRow(1); // a.txt
        h.testApp.sendKey("ArrowDown"); // New Folder
        h.testApp.sendKey("ArrowDown"); // Copy
        h.testApp.sendKey("Enter");
        h.testApp.render();
        expect(h.testApp.querySelector("PopupMenuElement")).toBeNull();

        // Курсор остался на a.txt → вставка в корень с авто-переименованием.
        h.commands.execute("fileOperations.paste");
        expect(fs.existsSync(ws.path("a copy.txt"))).toBe(true);
        expect(fs.existsSync(ws.path("a.txt"))).toBe(true);
    });

    it("Cut entry moves the file on the next paste", () => {
        rightClickRow(1); // a.txt
        h.testApp.sendKey("ArrowDown"); // New Folder
        h.testApp.sendKey("ArrowDown"); // Copy
        h.testApp.sendKey("ArrowDown"); // Cut
        h.testApp.sendKey("Enter");
        h.testApp.render();

        // Фокус вернулся на дерево после закрытия меню — стрелка двигает курсор на target/.
        h.testApp.sendKey("ArrowUp");
        h.commands.execute("fileOperations.paste");

        expect(fs.existsSync(path.join(ws.dir, "target", "a.txt"))).toBe(true);
        expect(fs.existsSync(ws.path("a.txt"))).toBe(false);
    });

    it("Paste entry appears for a non-empty clipboard and pastes into the clicked folder", () => {
        h.testApp.sendKey("ArrowDown"); // a.txt
        h.commands.execute("fileOperations.copy");

        rightClickRow(0); // target/
        expect(h.testApp.backend.screenToString()).toContain("Paste");
        h.testApp.sendKey("ArrowDown"); // New Folder
        h.testApp.sendKey("ArrowDown"); // Copy
        h.testApp.sendKey("ArrowDown"); // Cut
        h.testApp.sendKey("ArrowDown"); // Paste
        h.testApp.sendKey("Enter");
        h.testApp.render();

        expect(fs.existsSync(path.join(ws.dir, "target", "a.txt"))).toBe(true);
        expect(fs.existsSync(ws.path("a.txt"))).toBe(true);
    });

    // Order (empty clipboard): New File, New Folder, (sep), Copy, Cut, (sep),
    // Copy Path, Copy Relative Path, (sep), Delete.
    it("Copy Path entry puts the clicked file's absolute path on the clipboard", async () => {
        rightClickRow(1); // a.txt
        expect(h.testApp.backend.screenToString()).toContain("Copy Path");
        h.testApp.sendKey("ArrowDown"); // New Folder
        h.testApp.sendKey("ArrowDown"); // Copy
        h.testApp.sendKey("ArrowDown"); // Cut
        h.testApp.sendKey("ArrowDown"); // Copy Path
        h.testApp.sendKey("Enter");
        h.testApp.render();

        expect(h.testApp.querySelector("PopupMenuElement")).toBeNull();
        expect(await clipboard.readText()).toBe(ws.path("a.txt"));
    });

    it("Copy Relative Path entry puts the workspace-relative path on the clipboard", async () => {
        rightClickRow(1); // a.txt
        expect(h.testApp.backend.screenToString()).toContain("Copy Relative Path");
        h.testApp.sendKey("ArrowDown"); // New Folder
        h.testApp.sendKey("ArrowDown"); // Copy
        h.testApp.sendKey("ArrowDown"); // Cut
        h.testApp.sendKey("ArrowDown"); // Copy Path
        h.testApp.sendKey("ArrowDown"); // Copy Relative Path
        h.testApp.sendKey("Enter");
        h.testApp.render();

        expect(h.testApp.querySelector("PopupMenuElement")).toBeNull();
        expect(await clipboard.readText()).toBe("a.txt");
    });
});

describe("File explorer copy-path commands", () => {
    let ws: ITempWorkspace;
    let tmpDir: string;
    let h: IAppHarness;
    let clipboard: IClipboard;

    beforeEach(async () => {
        ws = createWorkspace();
        tmpDir = fs.realpathSync(ws.dir);
        h = createAppTestHarness({ workspaceFolder: tmpDir });
        clipboard = h.container.get(ClipboardDIToken);
        await h.workbench.activate();
        h.testApp.render();
        h.testApp.querySelector("TreeViewElement")!.focus();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("copyPath writes the absolute path of the selected file to the clipboard", async () => {
        h.testApp.sendKey("ArrowDown"); // cursor on a.txt
        h.commands.execute("fileOperations.copyPath");

        expect(await clipboard.readText()).toBe(path.join(tmpDir, "a.txt"));
    });

    it("copyRelativePath writes the workspace-relative path to the clipboard", async () => {
        h.testApp.sendKey("ArrowDown"); // cursor on a.txt
        h.commands.execute("fileOperations.copyRelativePath");

        expect(await clipboard.readText()).toBe("a.txt");
    });

    it("copyPath uses the explicit path argument when provided (context-menu path)", async () => {
        const target = path.join(tmpDir, "target");
        h.commands.execute("fileOperations.copyPath", target);

        expect(await clipboard.readText()).toBe(target);
    });

    it("copyRelativePath uses the explicit path argument when provided (context-menu path)", async () => {
        h.commands.execute("fileOperations.copyRelativePath", path.join(tmpDir, "target"));

        expect(await clipboard.readText()).toBe("target");
    });
});

describe("File explorer copy-path — no selection / no workspace root", () => {
    // App built without a workspace folder: the tree has no nodes (nothing selected)
    // and getRootPath() returns null.
    function createRootlessApp(): { h: IAppHarness; clipboard: IClipboard } {
        const h = createAppTestHarness();
        return { h, clipboard: h.container.get(ClipboardDIToken) };
    }

    it("copyPath is a no-op when nothing is selected", async () => {
        const { h, clipboard } = createRootlessApp();
        await h.workbench.activate();

        h.commands.execute("fileOperations.copyPath");
        expect(await clipboard.readText()).toBe("");
        h.dispose();
    });

    it("copyRelativePath is a no-op when nothing is selected", async () => {
        const { h, clipboard } = createRootlessApp();
        await h.workbench.activate();

        h.commands.execute("fileOperations.copyRelativePath");
        expect(await clipboard.readText()).toBe("");
        h.dispose();
    });

    it("copyRelativePath falls back to the absolute path when there is no workspace root", async () => {
        const { h, clipboard } = createRootlessApp();
        await h.workbench.activate();

        const abs = path.join("/tmp", "nowhere", "file.txt");
        h.commands.execute("fileOperations.copyRelativePath", abs);
        expect(await clipboard.readText()).toBe(abs);
        h.dispose();
    });
});
