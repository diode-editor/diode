import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";

import type { WorkbenchComponent } from "./workbenchComponent.ts";

let savedXdg: string | undefined;

function createWorkspace(): ITempWorkspace {
    const ws = createTempWorkspace({
        prefix: "diode-wsundo-scen-",
        files: {
            "a.txt": "AAA",
            "b.txt": "BBB",
            "doc.txt": "",
        },
    });
    fs.mkdirSync(ws.path("target"));
    // Изолированная корзина под этот тест — удаление обратимо и не трогает ~/.local.
    process.env.XDG_DATA_HOME = ws.path(".xdg");
    return ws;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function activeEditorText(workbench: WorkbenchComponent): string {
    const group = (workbench as unknown as { editorService: EditorService }).editorService;
    return group.getActiveEditor()?.getText() ?? "";
}

describe("Explorer undo/redo scenarios", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        savedXdg = process.env.XDG_DATA_HOME;
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
        if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = savedXdg;
    });

    // Удаление в корзину доступно → дефолтная кнопка ("Move to Trash") в фокусе, подтверждаем Enter.
    function confirmDelete(): void {
        h.testApp.render();
        expect(h.testApp.querySelector("#confirmDialog")).not.toBeNull();
        h.testApp.sendKey("Enter");
        h.testApp.render();
    }

    it("delete then undo restores the file", async () => {
        const a = ws.path("a.txt");
        h.commands.execute("fileOperations.deleteFile", a);
        confirmDelete();
        expect(fs.existsSync(a)).toBe(false);

        h.commands.execute("fileOperations.undo");
        await flush();
        expect(fs.readFileSync(a, "utf8")).toBe("AAA");
    });

    it("two deletes undo in LIFO order", async () => {
        const a = ws.path("a.txt");
        const b = ws.path("b.txt");
        h.commands.execute("fileOperations.deleteFile", a);
        confirmDelete();
        h.commands.execute("fileOperations.deleteFile", b);
        confirmDelete();

        h.commands.execute("fileOperations.undo");
        await flush();
        expect(fs.existsSync(b)).toBe(true); // последний удалённый восстановлен первым
        expect(fs.existsSync(a)).toBe(false);

        h.commands.execute("fileOperations.undo");
        await flush();
        expect(fs.existsSync(a)).toBe(true);
    });

    it("redo re-deletes after an undo", async () => {
        const a = ws.path("a.txt");
        h.commands.execute("fileOperations.deleteFile", a);
        confirmDelete();

        h.commands.execute("fileOperations.undo");
        await flush();
        expect(fs.existsSync(a)).toBe(true);

        h.commands.execute("fileOperations.redo");
        await flush();
        expect(fs.existsSync(a)).toBe(false);
    });

    it("editor and file-operation undo stacks are independent (VS Code model)", async () => {
        const a = ws.path("a.txt");
        const doc = ws.path("doc.txt");

        // Файловая операция в дереве (cut+paste = move, без диалога), фокус в дереве.
        // Дерево: target/(0), a.txt(1), b.txt(2), doc.txt(3).
        h.testApp.sendKey("ArrowDown"); // a.txt
        h.commands.execute("fileOperations.cut");
        h.testApp.sendKey("ArrowUp"); // target/
        h.commands.execute("fileOperations.paste");
        expect(fs.existsSync(a)).toBe(false);
        expect(fs.existsSync(ws.path("target/a.txt"))).toBe(true);

        // Правка текста в редакторе (отдельный стек по пути файла).
        h.commands.execute("workbench.openFile", doc);
        h.testApp.render();
        h.testApp.sendKey("x");
        h.testApp.render();
        expect(activeEditorText(h.workbench)).toContain("x");

        // Отмена в редакторе откатывает ТЕКСТ, файловую операцию не трогает.
        h.commands.execute("undo");
        h.testApp.render();
        expect(activeEditorText(h.workbench)).not.toContain("x");
        expect(fs.existsSync(a)).toBe(false); // move ещё в силе

        // Отмена файловой операции откатывает MOVE, текста не касается.
        h.commands.execute("fileOperations.undo");
        await flush();
        expect(fs.existsSync(a)).toBe(true);
        expect(activeEditorText(h.workbench)).not.toContain("x");
    });
});
