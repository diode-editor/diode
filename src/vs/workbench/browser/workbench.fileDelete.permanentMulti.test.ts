import * as fs from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

let savedXdg: string | undefined;
let ws: ITempWorkspace;
let h: IAppHarness;

// Tree, dirs first: row 0 "dir", row 1 "dir2", row 2 "a.txt".
beforeEach(async () => {
    savedXdg = process.env.XDG_DATA_HOME;
    ws = createTempWorkspace({
        prefix: "diode-permanent-multi-delete-",
        files: { "a.txt": "A", "dir/x.txt": "X", "dir2/y.txt": "Y", ".xdg": "a file, so no Trash can live under it" },
    });
    // XDG_DATA_HOME is a regular file: the trash directories can't be created, deletion is permanent.
    process.env.XDG_DATA_HOME = ws.path(".xdg");
    h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(120, 30) });
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

function screen(): string {
    h.testApp.render();
    return h.testApp.backend.screenToString();
}

describe.skipIf(process.platform !== "linux")("Explorer: permanent Delete on a multi-selection", () => {
    it("shows the whole 'This action is irreversible!' warning in a 120-column terminal", () => {
        h.testApp.sendKey("Shift+ArrowDown");
        h.testApp.sendKey("Shift+ArrowDown"); // dir + dir2 + a.txt
        h.testApp.sendKey("Delete");

        const frame = screen();
        expect(frame).toContain("The system Trash is not available.");
        expect(frame).toContain("Delete Permanently");
        // The single-file permanent dialog fits it on one line; with the multi-target question the
        // line is ~130 columns and the dialog cuts it off, so the user never sees the warning.
        expect(frame).toContain("This action is irreversible!");
        expect(fs.existsSync(ws.path("a.txt"))).toBe(true);
    });
});
