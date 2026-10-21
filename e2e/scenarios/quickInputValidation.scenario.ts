import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The message comes from the Open File dialog: Enter on a nonexistent path. The frame pins the alignment: the
// query and the message share a column, and a long message is cut at the right padding of the list rows.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "quick-input-validation",
    title: "Validation message under the query line (Open File dialog)",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Ctrl+P");
        await editor.waitForText((t) => t.includes("Go to File"));
        await editor.sendText(">open file");
        await editor.waitForText((t) => t.includes("Open File"));
        await editor.capture("palette");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Open File") && t.includes(".github"));

        await editor.sendText("definitely-missing.txt");
        await editor.waitForText((t) => t.includes("definitely-missing.txt"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Please enter a path that exists."));
        await editor.capture("error");
    },
});
