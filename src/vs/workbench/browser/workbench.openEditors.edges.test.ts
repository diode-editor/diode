import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

/** Open Editors as the user sees it: the rows of the section in the frame. */
describe("Workbench — Explorer: Open Editors (frame edges)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function boot(files: Record<string, string>): void {
        ws = createTempWorkspace({ prefix: "diode-open-editors-edges-", files });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 30) });
    }

    /** The text rows of the Open Editors section (list area under its header), trailing blanks trimmed. */
    async function sectionRows(): Promise<string[]> {
        await new Promise((resolve) => setTimeout(resolve, 0));
        h.testApp.render();
        const section = h.testApp.querySelector("#openEditorsView")!;
        const origin = section.globalPosition;
        const screen = h.testApp.app.screen;
        const rows: string[] = [];
        for (let y = 0; y < section.layoutSize.height; y++) {
            let row = "";
            for (let x = 0; x < section.layoutSize.width; x++) {
                row += screen.getCell(new Point(origin.x + x, origin.y + y)).char;
            }
            rows.push(row.trimEnd());
        }
        return rows;
    }

    describe("a modified editor", () => {
        beforeEach(() => {
            boot({ "alpha.txt": "alpha", "beta.txt": "beta" });
            h.commands.execute("workbench.openFile", ws.path("beta.txt"));
            h.commands.execute("workbench.openFile", ws.path("alpha.txt"));
        });

        it("the active modified editor shows ● in its row while the mouse is elsewhere (as upstream's :not(:hover))", async () => {
            h.commands.execute("workbench.files.action.focusOpenEditorsView");
            h.commands.execute("workbench.action.focusActiveEditorGroup");
            h.activeEditor().viewState.type("X");

            const alpha = (await sectionRows()).find((row) => row.includes("alpha.txt"));
            expect(alpha).toContain("●");
            expect(alpha).not.toContain("×");
        });
    });

    describe("more editors than the section shows", () => {
        const files = Object.fromEntries(
            Array.from({ length: 14 }, (_, i) => [`f${String(i + 1).padStart(2, "0")}.txt`, ""]),
        );

        beforeEach(() => {
            boot(files);
            for (const file of Object.keys(files)) {
                h.commands.execute("workbench.openFile", ws.path(file));
            }
        });

        it("showing the section for the first time scrolls the active editor's row into view", async () => {
            // f14.txt is the active editor and the 14th row; the section holds 9 (explorer.openEditors.visible).
            h.commands.execute("workbench.files.action.focusOpenEditorsView");

            const rows = await sectionRows();
            expect(rows.some((row) => row.includes("f14.txt"))).toBe(true);
        });
    });

    describe("an editor with a long description", () => {
        let outside: ITempWorkspace;

        beforeEach(() => {
            boot({ "a.txt": "", "b.txt": "" });
            outside = createTempWorkspace({
                prefix: "diode-open-editors-a-folder-with-a-rather-long-name-outside-the-workspace-",
                files: { "settings.json": "{}" },
            });
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            h.commands.execute("workbench.openFile", ws.path("b.txt"));
            h.commands.execute("workbench.openFile", outside.path("settings.json"));
        });

        afterEach(() => {
            outside.dispose();
        });

        it("three editors (fewer than explorer.openEditors.visible) are all on screen at once", async () => {
            h.commands.execute("workbench.files.action.focusOpenEditorsView");

            const rows = await sectionRows();
            expect(rows.filter((row) => /\b(a\.txt|b\.txt|settings\.json)\b/u.test(row))).toHaveLength(3);
        });
    });
});
