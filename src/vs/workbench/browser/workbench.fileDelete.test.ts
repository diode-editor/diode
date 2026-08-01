import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Offset, Point } from "../../../../tuidom/common/geometryPromitives.ts";
import { TUIContextMenuEvent, TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import type { TreeViewElement } from "../../../../tuidom/ui/tree/treeViewElement.ts";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

let savedXdg: string | undefined;

function createWorkspace(): ITempWorkspace {
    const ws = createTempWorkspace({
        prefix: "vexx-file-delete-integration-",
        files: {
            "alpha.txt": "Alpha content",
            "beta.txt": "Beta content",
        },
    });
    // Изолированная корзина под этот тест, чтобы удаление было обратимым и не трогало ~/.local.
    process.env.XDG_DATA_HOME = ws.path(".xdg");
    return ws;
}

describe("fileOperations.deleteFile command", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        savedXdg = process.env.XDG_DATA_HOME;
        ws = createWorkspace();
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = savedXdg;
    });

    // Удаление теперь спрашивает подтверждение; корзина доступна → дефолтная кнопка
    // ("Move to Trash") в фокусе, подтверждаем её Enter.
    function confirmDelete(): void {
        expect(h.testApp.querySelector("#confirmDialog")).not.toBeNull();
        h.testApp.sendKey("Enter");
        h.testApp.render();
    }

    it("deletes the specified file after confirmation", () => {
        const filePath = ws.path("alpha.txt");
        expect(fs.existsSync(filePath)).toBe(true);

        h.commands.execute("fileOperations.deleteFile", filePath);
        h.testApp.render();
        confirmDelete();

        expect(fs.existsSync(filePath)).toBe(false);
    });

    it("asks for confirmation and does not delete until confirmed", () => {
        const filePath = ws.path("alpha.txt");

        h.commands.execute("fileOperations.deleteFile", filePath);
        h.testApp.render();

        // Dialog is up, file still on disk.
        expect(h.testApp.querySelector("#confirmDialog")).not.toBeNull();
        expect(fs.existsSync(filePath)).toBe(true);
    });

    it("does not delete other files when deleting one", () => {
        const alpha = ws.path("alpha.txt");
        const beta = ws.path("beta.txt");

        h.commands.execute("fileOperations.deleteFile", alpha);
        h.testApp.render();
        confirmDelete();

        expect(fs.existsSync(alpha)).toBe(false);
        expect(fs.existsSync(beta)).toBe(true);
    });

    it("restores the file on undo (Ctrl+Z in the explorer)", async () => {
        const filePath = ws.path("alpha.txt");

        h.commands.execute("fileOperations.deleteFile", filePath);
        h.testApp.render();
        confirmDelete();
        expect(fs.existsSync(filePath)).toBe(false);

        await h.commands.execute("fileOperations.undo");
        h.testApp.render();

        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, "utf8")).toBe("Alpha content");
    });

    it("command is registered and executable without throwing", () => {
        const nonExistent = ws.path("ghost.txt");
        expect(() => h.commands.execute("fileOperations.deleteFile", nonExistent)).not.toThrow();
    });

    it("is a no-op when called without an argument and nothing is selected in the tree", () => {
        // No workspace folder → no tree → no selected node to fall back to.
        const bare = createAppTestHarness();

        expect(() => bare.commands.execute("fileOperations.deleteFile")).not.toThrow();
        bare.dispose();
    });
});

describe("Delete key in the file tree", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        savedXdg = process.env.XDG_DATA_HOME;
        ws = createWorkspace();
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = savedXdg;
    });

    function getTreeElement(): TreeViewElement<unknown> {
        const el = h.testApp.querySelector("TreeViewElement");
        expect(el).not.toBeNull();
        return el as TreeViewElement<unknown>;
    }

    function confirmDelete(): void {
        expect(h.testApp.querySelector("#confirmDialog")).not.toBeNull();
        h.testApp.sendKey("Enter");
        h.testApp.render();
    }

    it("pressing Delete deletes the file selected in the focused tree after confirmation", () => {
        const alpha = ws.path("alpha.txt");
        const beta = ws.path("beta.txt");

        const tree = getTreeElement();
        tree.focus();
        h.testApp.render();

        // Row 0 (alpha.txt) is selected by default.
        h.testApp.sendKey("Delete");
        h.testApp.render();
        expect(fs.existsSync(alpha)).toBe(true); // not deleted until confirmed
        confirmDelete();

        expect(fs.existsSync(alpha)).toBe(false);
        expect(fs.existsSync(beta)).toBe(true);
    });

    it("pressing Delete deletes the file the cursor was moved to", () => {
        const alpha = ws.path("alpha.txt");
        const beta = ws.path("beta.txt");

        const tree = getTreeElement();
        tree.focus();
        h.testApp.render();

        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Delete");
        h.testApp.render();
        confirmDelete();

        expect(fs.existsSync(alpha)).toBe(true);
        expect(fs.existsSync(beta)).toBe(false);
    });

    it("does not delete tree files when the tree is not focused", () => {
        const alpha = ws.path("alpha.txt");

        h.workbench.openFile(alpha);
        h.workbench.focusEditor();
        h.testApp.render();

        h.testApp.sendKey("Delete");
        h.testApp.render();

        expect(h.testApp.querySelector("#confirmDialog")).toBeNull();
        expect(fs.existsSync(alpha)).toBe(true);
    });
});

describe("File tree context menu — right-click opens context menu", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        savedXdg = process.env.XDG_DATA_HOME;
        ws = createWorkspace();
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = savedXdg;
    });

    function getTreeElement(): TreeViewElement<unknown> {
        const el = h.testApp.querySelector("TreeViewElement");
        expect(el).not.toBeNull();
        return el as TreeViewElement<unknown>;
    }

    function rightClickRow(tree: TreeViewElement<unknown>, row: number): void {
        tree.localPosition = new Offset(0, 0);
        tree.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "mouse",
                button: "right",
                screenX: 2,
                screenY: row,
                localX: 2,
                localY: row,
            }),
        );
        h.testApp.render();
    }

    it("right-click on a file in the tree opens a context menu popup", () => {
        const tree = getTreeElement();
        tree.focus();
        h.testApp.render();

        rightClickRow(tree, 0);

        expect(h.testApp.querySelector("PopupMenuElement")).not.toBeNull();
    });

    it("context menu contains a Delete entry", () => {
        const tree = getTreeElement();
        tree.focus();
        h.testApp.render();

        rightClickRow(tree, 0);

        const items = h.testApp.querySelectorAll("PopupMenuItemElement");
        expect(items.length).toBeGreaterThan(0);
        expect(h.testApp.backend.screenToString()).toContain("Delete");
    });

    it("selecting Delete closes the menu and opens a confirmation, then deletes", () => {
        const tree = getTreeElement();
        tree.focus();
        h.testApp.render();

        const alpha = ws.path("alpha.txt");
        rightClickRow(tree, 0);
        expect(h.testApp.querySelector("PopupMenuElement")).not.toBeNull();

        // Menu order is New File, New Folder, (sep), Copy, Cut, (sep), Copy Path,
        // Copy Relative Path, (sep), Rename, Delete — navigate down to Delete
        // (separators are skipped) and activate it.
        for (let i = 0; i < 7; i++) h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        h.testApp.render();

        // Menu closed; confirmation dialog is up; file not yet deleted.
        expect(h.testApp.querySelector("PopupMenuElement")).toBeNull();
        expect(h.testApp.querySelector("#confirmDialog")).not.toBeNull();
        expect(fs.existsSync(alpha)).toBe(true);

        h.testApp.sendKey("Enter"); // confirm "Move to Trash"
        h.testApp.render();
        expect(fs.existsSync(alpha)).toBe(false);
    });

    it("right-clicking a second file replaces the existing context menu", () => {
        const tree = getTreeElement();
        tree.focus();
        h.testApp.render();

        rightClickRow(tree, 0);
        expect(h.testApp.querySelector("PopupMenuElement")).not.toBeNull();

        rightClickRow(tree, 1);
        expect(h.testApp.querySelectorAll("PopupMenuElement")).toHaveLength(1);
    });

    it("pressing Escape closes the context menu and returns focus to the tree", () => {
        const tree = getTreeElement();
        tree.focus();
        h.testApp.render();

        rightClickRow(tree, 0);
        expect(h.testApp.querySelector("PopupMenuElement")).not.toBeNull();

        h.testApp.sendKey("Escape");
        h.testApp.render();

        expect(h.testApp.querySelector("PopupMenuElement")).toBeNull();
        expect(h.testApp.focusedElement).toBe(tree);
    });

    it("selecting a menu entry returns focus to the tree without activating the row", () => {
        const tree = getTreeElement();
        tree.focus();
        h.testApp.render();

        rightClickRow(tree, 0);
        expect(h.testApp.focusedElement).not.toBe(tree); // фокус ушёл в меню

        // Активируем безобидный пункт (Copy — 3-й: пропускаем New File, New Folder),
        // который просто закрывает меню. Первые пункты (New File/New Folder) открыли
        // бы строковый промпт и увели фокус в него, а не в дерево.
        h.testApp.sendKey("ArrowDown"); // New Folder
        h.testApp.sendKey("ArrowDown"); // Copy
        h.testApp.sendKey("Enter"); // Copy
        h.testApp.render();

        expect(h.testApp.querySelector("PopupMenuElement")).toBeNull();
        // Фокус вернулся дереву, а парный keypress того же Enter не «протёк» в дерево
        // и не открыл файл под курсором в редакторе.
        expect(h.testApp.focusedElement).toBe(tree);
    });
});
