import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Gutter digit column under folding: the fixture has 128 logical lines that
// collapse into 8 view lines (8 functions, 16 lines each). The gutter must keep
// its 3-digit column sized by *logical* line numbers — the regression computed
// it from the folded view line count (8 → 1 digit) and truncated "113" in the
// rendered gutter. The folded frame with a full "113" against stage8's header
// is the assertion.

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

        // Fold All is Ctrl+K Ctrl+0, but the headless key DSL can only encode
        // Ctrl+letter — so fold each region via Ctrl+K Ctrl+L (toggle fold at
        // cursor). The cursor starts on stage1's header; a fold hides the body
        // but leaves the closing brace visible, so two ArrowDowns skip over it
        // onto the next function's header.
        for (let i = 0; i < 8; i++) {
            await editor.sendKey("Ctrl+K");
            await editor.sendKey("Ctrl+L");
            await editor.sendKey("ArrowDown");
            await editor.sendKey("ArrowDown");
        }
        // All 8 bodies hidden → stage8's header (logical line 113) is on screen.
        await editor.waitForText((t) => t.includes("stage8") && !t.includes("step1 "));
        await editor.capture("all-folded");
    },
});
