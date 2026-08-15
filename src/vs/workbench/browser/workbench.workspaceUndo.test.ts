import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

// Дерево: dirs-first → row 0 = "target/", row 1 = "a.txt".
function createWorkspace(): ITempWorkspace {
    const ws = createTempWorkspace({ prefix: "diode-wsundo-", files: { "a.txt": "hello" } });
    fs.mkdirSync(ws.path("target"));
    return ws;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("Explorer undo/redo of file operations", () => {
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

    it("undo of a cut+paste moves the file back (no confirmation)", async () => {
        h.testApp.sendKey("ArrowDown"); // a.txt
        h.commands.execute("fileOperations.cut");
        h.testApp.sendKey("ArrowUp"); // target/
        h.commands.execute("fileOperations.paste");
        expect(fs.existsSync(ws.path("target/a.txt"))).toBe(true);
        expect(fs.existsSync(ws.path("a.txt"))).toBe(false);

        h.commands.execute("fileOperations.undo");
        await flush();

        // Move undo is not destructive → no dialog, file is back at its original place.
        expect(h.testApp.querySelector("#confirmDialog")).toBeNull();
        expect(fs.existsSync(ws.path("a.txt"))).toBe(true);
        expect(fs.existsSync(ws.path("target/a.txt"))).toBe(false);
    });

    it("undo of a copy+paste asks for confirmation, then deletes the created copy", async () => {
        h.testApp.sendKey("ArrowDown"); // a.txt
        h.commands.execute("fileOperations.copy");
        h.testApp.sendKey("ArrowUp"); // target/
        h.commands.execute("fileOperations.paste");
        const copy = ws.path("target/a.txt");
        expect(fs.existsSync(copy)).toBe(true);

        h.commands.execute("fileOperations.undo");
        h.testApp.render();

        // Destructive undo → confirmation dialog; copy still there until confirmed.
        expect(h.testApp.querySelector("#confirmDialog")).not.toBeNull();
        expect(fs.existsSync(copy)).toBe(true);

        h.testApp.sendKey("ArrowLeft"); // focus the confirm ("Yes") button
        h.testApp.sendKey("Enter");
        await flush();

        expect(fs.existsSync(copy)).toBe(false);
        expect(fs.existsSync(ws.path("a.txt"))).toBe(true); // original untouched
    });

    it("redo re-applies a move after undo", async () => {
        h.testApp.sendKey("ArrowDown"); // a.txt
        h.commands.execute("fileOperations.cut");
        h.testApp.sendKey("ArrowUp"); // target/
        h.commands.execute("fileOperations.paste");

        h.commands.execute("fileOperations.undo");
        await flush();
        expect(fs.existsSync(ws.path("a.txt"))).toBe(true);

        h.commands.execute("fileOperations.redo");
        await flush();
        expect(fs.existsSync(ws.path("target/a.txt"))).toBe(true);
        expect(fs.existsSync(ws.path("a.txt"))).toBe(false);
    });
});
