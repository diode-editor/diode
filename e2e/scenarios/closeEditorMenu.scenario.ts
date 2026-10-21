import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "close-editor-menu",
    title: "Close Editor in the File menu",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Alt+F");
        await editor.waitForText((t) => t.includes("Close Editor") && t.includes("Exit"));
        await editor.capture("menu");
    },
});
