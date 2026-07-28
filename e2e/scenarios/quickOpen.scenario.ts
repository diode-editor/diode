import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Reference scenario + template for new ones: open a workspace and a file, then
// exercise a visible flow (Quick Open) and screenshot each state.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "quick-open",
    title: "Quick Open (Ctrl+P) over an open file",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        // The opened file has rendered in the editor pane.
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("editor");

        // Open the Quick Open overlay and screenshot it.
        await editor.sendKey("Ctrl+P");
        await editor.waitForText((t) => t.includes("Go to File"));
        await editor.capture("overlay");

        // Низкий терминал: контракт performLayout (Н1) — пикер обязан ужаться в
        // выделенную высоту (короткое окно списка, целая нижняя рамка), а не
        // рисовать natural-высоту под обрезку клипом.
        await editor.resize(120, 10);
        await editor.waitForText((t) => t.includes("Go to File"));
        await editor.capture("low-terminal");
    },
});
