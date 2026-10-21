import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// 128 logical lines fold into 8 view lines: the gutter must stay 3 digits wide by *logical* numbers — the
// regression sized it by view lines and truncated "113".

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "gutterWidthFolding.ts");

export default defineScenario({
    name: "gutter-width-folding",
    title: "Gutter keeps 3-digit numbers when folds shrink the view",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("stage1"));
        await editor.capture("rest");

        // Fold All (Ctrl+K Ctrl+0) isn't encodable in the key DSL, so each region folds via Ctrl+K Ctrl+L; a fold leaves
        // the closing brace visible, hence two ArrowDowns to the next header.
        for (let i = 0; i < 8; i++) {
            await editor.sendKey("Ctrl+K");
            await editor.sendKey("Ctrl+L");
            await editor.sendKey("ArrowDown");
            await editor.sendKey("ArrowDown");
        }
        // stage8's header is logical line 113.
        await editor.waitForText((t) => t.includes("stage8") && !t.includes("step1 "));
        await editor.capture("all-folded");
    },
});
