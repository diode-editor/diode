import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The file dialog is a port of the reference SimpleFileDialog on the QuickInput overlay.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "open-file",
    title: "Open File / Open Folder via the file dialog",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Alt+F");
        await editor.waitForText((t) => t.includes("Open File") && t.includes("Open Folder"));
        await editor.capture("menu");
        await editor.sendKey("Escape");

        // Folders come first, so README.md is below the visible rows — wait for a folder that always shows.
        await editor.sendKey("Ctrl+O");
        await editor.waitForText((t) => t.includes("Open File") && t.includes(".github") && t.includes(".."));
        await editor.capture("prompt");

        await editor.sendText("READ");
        await editor.waitForText((t) => t.includes("READ") && t.includes("README.md"));
        await editor.capture("prompt-typed");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("README.md") && !t.includes("Open File"));
        await editor.capture("opened");
    },
});
