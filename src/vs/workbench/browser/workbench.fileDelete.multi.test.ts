import * as fs from "node:fs";

import { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ContextMenuServiceDIToken } from "../../platform/contextview/browser/contextMenuService.ts";

let savedXdg: string | undefined;
let ws: ITempWorkspace;
let h: IAppHarness;

// Tree, dirs first: row 0 "dir", row 1 "a.txt", row 2 "b.txt", row 3 "c.txt".
beforeEach(async () => {
    savedXdg = process.env.XDG_DATA_HOME;
    ws = createTempWorkspace({
        prefix: "diode-multi-delete-",
        files: { "a.txt": "A", "b.txt": "B", "c.txt": "C", "dir/x.txt": "X" },
    });
    // A dedicated trash, so deletion is reversible and leaves ~/.local alone.
    process.env.XDG_DATA_HOME = ws.path(".xdg");
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

function screen(): string {
    h.testApp.render();
    return h.testApp.backend.screenToString();
}

const ALL = ["dir", "a.txt", "b.txt", "c.txt"];

describe.skipIf(process.platform !== "linux")("Explorer: Delete on a multi-selection", () => {
    it("Shift+↓ selection → Delete lists every target, confirm removes all, one Ctrl+Z brings all back", async () => {
        for (let i = 0; i < 3; i++) h.testApp.sendKey("Shift+ArrowDown");
        h.testApp.sendKey("Delete");

        const frame = screen();
        expect(frame).toContain("Are you sure you want to delete the following 4");
        for (const name of ["a.txt", "b.txt", "c.txt"]) expect(frame).toContain(name);
        expect(frame).toContain("You can restore these files using the Undo command");

        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            for (const name of ALL) expect(fs.existsSync(ws.path(name))).toBe(false);
        });
        await vi.waitFor(() => {
            expect(screen()).not.toContain("b.txt");
        });

        h.testApp.querySelector("TreeViewElement")!.focus();
        h.testApp.sendKey("Ctrl+Z");
        await vi.waitFor(() => {
            for (const name of ALL) expect(fs.existsSync(ws.path(name))).toBe(true);
        });
        expect(fs.readFileSync(ws.path("dir/x.txt"), "utf8")).toBe("X");
    });

    it("Escape in the dialog deletes nothing", () => {
        h.testApp.sendKey("Shift+ArrowDown");
        h.testApp.sendKey("Delete");
        expect(screen()).toContain("Are you sure you want to delete the following 2 files/directories");
        h.testApp.sendKey("Escape");
        h.testApp.render();
        expect(h.testApp.querySelector("#confirmDialog")).toBeNull();
        for (const name of ALL) expect(fs.existsSync(ws.path(name))).toBe(true);
    });

    it("the context menu carries the selection for a row inside it and the row alone outside it", () => {
        const show = vi
            .spyOn(h.container.get(ContextMenuServiceDIToken), "showContextMenu")
            .mockImplementation(() => {});
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Shift+ArrowDown"); // a.txt + b.txt
        h.testApp.render();
        const rightClick = (row: number): void => {
            h.testApp.focusedElement?.dispatchEvent(
                new TUIContextMenuEvent({
                    trigger: "mouse",
                    button: "right",
                    screenX: 6,
                    screenY: row,
                    localX: 6,
                    localY: row,
                }),
            );
        };
        rightClick(2);
        expect(show.mock.calls.at(-1)?.[0]).toMatchObject({
            menuContext: { path: ws.path("b.txt"), targets: [ws.path("a.txt"), ws.path("b.txt")] },
        });
        rightClick(3);
        expect(show.mock.calls.at(-1)?.[0]).toMatchObject({
            menuContext: { path: ws.path("c.txt"), targets: [ws.path("c.txt")] },
        });
    });
});
