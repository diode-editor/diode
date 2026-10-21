import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The headless driver can't hover the gutter, so the shots document the resting state: no expanded chevrons.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "folding.ts");

export default defineScenario({
    name: "folding-chevrons",
    title: "Fold chevrons hidden at rest, collapsed one stays",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("alpha"));
        await editor.capture("rest");

        // Line 0 is a comment, alpha's region is lines 1..3. Ctrl+K Ctrl+L, because the key DSL can't serialize
        // Ctrl+Shift+[.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+L");
        // Width-independent check: the ⋯ marker's column depends on the pane width.
        await editor.waitForText((t) => !t.includes("const doubled"));
        await editor.capture("one-folded");
    },
});
