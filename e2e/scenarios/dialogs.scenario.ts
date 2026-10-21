import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "dialogs",
    title: "Modal dialogs (workbench components): confirm-save and About",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendText("x");
        await editor.sendKey("Ctrl+W");
        await editor.waitForText((t) => t.includes("Do you want to save"));
        await editor.capture("confirm-save");

        await editor.sendKey("Escape");
        await editor.sendKey("Alt+H");
        await editor.waitForText((t) => t.includes("About"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Version"));
        await editor.capture("about");
    },
});
