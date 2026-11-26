import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Russian layout with extended keys: Ctrl+Shift+Cyrillic Ha arrives as CSI 1093;6u, and only its code
// (BracketLeft) says it is the physical [ key. The binding Ctrl+Shift+[ matches it by that code, as VS Code's
// `keyboard.dispatch: code` does on Linux.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "folding.ts");

export default defineScenario({
    name: "fold-russian-layout",
    // Ctrl+Shift and Shift+Alt shortcuts need an extended tier, which only an explicit setting turns on (#1049).
    settings: { "terminal.tier": "csi-u" },
    title: "Ctrl+Shift+Cyrillic Ha folds like Ctrl+Shift+[ in the Russian layout",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("alpha"));
        // The regions are computed after a delay: wait for the state, or the fold would land on no region.
        await editor.waitForState("EditorElement", (state) => {
            const regions = state?.foldedRegions;
            return Array.isArray(regions) && regions.length > 0;
        });

        // Line 0 is a comment, alpha's region is lines 1..3.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+Shift+\u0425"); // Cyrillic capital Ha
        await editor.waitForText((t) => !t.includes("const doubled"));
        await editor.capture("folded");
    },
});
