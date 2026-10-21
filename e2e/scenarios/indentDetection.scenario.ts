import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Indentation is checked by insertion, not by the text (it is already indented): the same Tab gives 2 columns in
// package.json and 4 in 4-space TypeScript.

const twoSpaceJson = resolve(repoRoot, "package.json");
const fourSpaceTs = resolve(repoRoot, "e2e", "fixtures", "folding.ts");

export default defineScenario({
    name: "indent-detection",
    title: "Автоопределение отступа по содержимому файла",
    open: [repoRoot, fourSpaceTs, twoSpaceJson],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes('"scripts"'));
        await editor.sendKey("Ctrl+End");
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Col 3"));
        await editor.capture("two-space-json");

        // Ctrl+Tab holds a session with a list over the editor; Ctrl+End ends it, so wait for the tab's text only
        // after moving the cursor.
        await editor.sendKey("Ctrl+Tab");
        await editor.sendKey("Ctrl+End");
        await editor.waitForText((t) => t.includes("const doubled"));
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Col 5"));
        await editor.capture("four-space-ts");
    },
});
