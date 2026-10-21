import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// A 128-line fixture, so scrolling to line 30 shows in the frame.
const sampleFile = resolve(repoRoot, "e2e", "fixtures", "gutterWidthFolding.ts");

export default defineScenario({
    name: "goto-arg",
    title: "CLI -g file:line:column — cursor at the given position",
    extraArgs: ["-g"],
    open: [`${sampleFile}:30:7`],
    cols: 120,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("Ln 30, Col 7"));
        await editor.capture("goto");
    },
});
