import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const spacesFile = resolve(repoRoot, "e2e", "fixtures", "indentDemoSpaces.ts");

export default defineScenario({
    name: "indentationStatus",
    title: "Status bar indentation indicator (Spaces / Tab Size)",
    open: [repoRoot, spacesFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("Spaces: 2"));
        await editor.capture("spaces");

        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText("indentDemoTabs");
        // Wait for the picker row (name + "e2e/fixtures"): the name is visible in Explorer too, and an Enter before
        // filtering would be wasted.
        await editor.waitForText((t) => t.includes("e2e/fixtures"));
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("Tab Size: 4"));
        await editor.capture("tab-size");
    },
});
