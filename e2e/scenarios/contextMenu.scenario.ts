import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Context menu via keyboard (Shift+F10, VS Code default). The same menu a right
// click produces, opened from the keyboard on whichever component is focused:
// anchored at the caret in the editor, and at the selected row in the explorer.
// `when` (textInputFocus / listFocus) routes the shared binding to the right menu.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "context-menu",
    title: "Context menu via Shift+F10 (editor + explorer)",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        // Editor is focused on the opened sample file — Shift+F10 pops its menu at the caret.
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("Copy") && t.includes("Paste"));
        await editor.capture("editor");
        await editor.sendKey("Escape");

        // Focus the explorer via the View menu (Alt+V → "Explorer", three steps down
        // past the pre-selected Command Palette) — the tier-independent
        // entry point other scenarios also use. Opening the file above auto-revealed and
        // selected it in the tree, so the cursor is already on a concrete node.
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Explorer"));
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("sample.ts"));

        // Shift+F10 pops the explorer menu at the selected row.
        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("New File") && t.includes("Rename"));
        await editor.capture("explorer");
    },
});
