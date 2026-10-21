import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "context-menu",
    title: "Context menu via Shift+F10 (editor + explorer)",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("Copy") && t.includes("Paste"));
        await editor.capture("editor");
        await editor.sendKey("Escape");

        // The View menu (Alt+V → Explorer) is tier-independent; opening the file above already selected its tree row.
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Explorer"));
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("sample.ts"));

        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("New File") && t.includes("Rename"));
        await editor.capture("explorer");
    },
});
