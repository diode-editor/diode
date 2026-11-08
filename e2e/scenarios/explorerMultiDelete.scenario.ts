import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Delete on a multi-selection in the explorer: the dialog lists every selected item, confirming
// moves them all to the trash, and one Ctrl+Z brings them all back.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-multi-delete-demo-"));
// The freedesktop trash lives in a temp directory, not in the home of whoever runs e2e.
const dataHome = mkdtempSync(join(tmpdir(), "diode-multi-delete-xdg-"));
const names = ["dir", "a.txt", "b.txt", "c.txt"];

export default defineScenario({
    name: "explorer-multi-delete",
    title: "Explorer: Delete on a multi-selection lists every item and deletes them as one undo step",
    open: [sampleDir],
    cols: 100,
    rows: 24,
    env: { XDG_DATA_HOME: dataHome },
    // The freedesktop trash exists only on Linux; elsewhere the dialog offers permanent deletion.
    skipOn: ["win32", "darwin"],
    async prepare() {
        mkdirSync(join(sampleDir, "dir"), { recursive: true });
        writeFileSync(join(sampleDir, "dir", "x.txt"), "x\n");
        for (const name of ["a.txt", "b.txt", "c.txt"]) writeFileSync(join(sampleDir, name), `${name}\n`);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("c.txt"));
        // Focus the tree via the View menu (tier-independent), then select all four rows.
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Explorer"));
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.sendKey("Home");
        for (let i = 0; i < 3; i++) await editor.sendKey("Shift+ArrowDown");
        await editor.capture("selection");

        await editor.sendKey("Delete");
        await editor.waitForText((t) =>
            t.includes("Are you sure you want to delete the following 4 files/directories and their contents?"),
        );
        await editor.capture("dialog");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("b.txt") && !t.includes("c.txt"), { timeoutMs: 10_000 });
        if (names.some((name) => existsSync(join(sampleDir, name)))) throw new Error("not every item was deleted");
        await editor.capture("deleted");

        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes("a.txt") && t.includes("c.txt"), { timeoutMs: 10_000 });
        if (!names.every((name) => existsSync(join(sampleDir, name)))) throw new Error("undo did not restore every item");
        await editor.capture("restored");
    },
});
