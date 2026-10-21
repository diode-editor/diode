import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// N3: the theme palette lives in the root var-scope; switching themes repaints the tree with a single push (no
// per-component updateStyles).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "theme-swap",
    title: "Смена темы: токены + корневой var-scope (Н3)",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("dark-plus");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+T");
        await editor.waitForText((t) => t.includes("Light+"));
        await editor.capture("picker");

        await editor.sendText("Light+");
        await editor.waitForText((t) => t.includes("Light+"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("light-plus");
    },
});
