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
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("editor");

        await editor.sendKey("Ctrl+P");
        await editor.waitForText((t) => t.includes("Go to File"));
        await editor.capture("overlay");

        // Short terminal: the performLayout contract (N1) — the picker shrinks to the allotted height instead of being
        // clipped.
        await editor.resize(120, 10);
        await editor.waitForText((t) => t.includes("Go to File"));
        await editor.capture("low-terminal");
    },
});
