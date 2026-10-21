import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Ctrl+Shift+E needs a csi-u/kitty terminal to encode, so the explorer is focused through the View menu.
// Rename mutates the filesystem, so the scenario uses a throwaway temp workspace.

const OLD_NAME = "notes.txt";
const NEW_NAME = "guide.md";

const workspace = mkdtempSync(join(tmpdir(), "diode-rename-demo-"));
writeFileSync(join(workspace, OLD_NAME), "Project notes.\n");

export default defineScenario({
    name: "rename",
    title: "Rename a file in the explorer (F2)",
    open: [workspace],
    cols: 100,
    rows: 28,
    async run(editor) {
        // "Explorer" is three steps down past the pre-selected first item.
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Explorer"));
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes(OLD_NAME));
        await editor.capture("explorer");

        await editor.sendKey("F2");
        await editor.waitForText((t) => t.includes("Rename") && t.includes(OLD_NAME));
        await editor.capture("prompt");

        // The cursor is seeded at the end of the pre-filled name.
        for (let i = 0; i < OLD_NAME.length; i++) await editor.sendKey("Backspace");
        await editor.sendText(NEW_NAME);
        await editor.waitForText((t) => t.includes("Rename") && t.includes(NEW_NAME));
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes(NEW_NAME) && !t.includes(OLD_NAME));
        await editor.capture("renamed");
    },
});
