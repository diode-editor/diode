import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Rename a file in the explorer (VS Code `renameFile`, F2). Focus the tree, press
// F2 to open the inline rename prompt (pre-filled with the current name), clear it,
// type a new name, and confirm.
//
// The Ctrl+Shift+E keybinding needs a csi-u/kitty terminal to encode, so — like the
// terminal scenario reaches the palette — we focus the explorer tier-independently
// through the View menu (Alt+V → "Explorer"), the entry point that always works.
//
// Isolation: rename mutates the filesystem, so the scenario opens a throwaway temp
// workspace with a single seeded file instead of the repo — the demo never touches
// tracked files.

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
        // Focus the explorer via the View menu (Alt+V → "Explorer": Command Palette,
        // Color Theme, Explorer — two steps down past the pre-selected first item).
        // Its cursor lands on the sole file.
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Explorer"));
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes(OLD_NAME));
        await editor.capture("explorer");

        // F2 opens the rename input, pre-filled with the current name.
        await editor.sendKey("F2");
        await editor.waitForText((t) => t.includes("Rename") && t.includes(OLD_NAME));
        await editor.capture("prompt");

        // Clear the pre-filled name (cursor is seeded at the end) and type the new one.
        for (let i = 0; i < OLD_NAME.length; i++) await editor.sendKey("Backspace");
        await editor.sendText(NEW_NAME);
        await editor.waitForText((t) => t.includes("Rename") && t.includes(NEW_NAME));
        await editor.sendKey("Enter");

        // The tree now shows the renamed file; the old name is gone.
        await editor.waitForText((t) => t.includes(NEW_NAME) && !t.includes(OLD_NAME));
        await editor.capture("renamed");
    },
});
