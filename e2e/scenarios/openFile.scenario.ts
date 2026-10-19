import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Open File... / Open Folder...: the File menu gains two entries, and each opens
// the file dialog (port of the reference SimpleFileDialog on the QuickInput
// overlay): the path lives in the query line, the folder's entries below it.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "open-file",
    title: "Open File / Open Folder via the file dialog",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // File menu now lists the two new commands with their shortcuts.
        await editor.sendKey("Alt+F");
        await editor.waitForText((t) => t.includes("Open File") && t.includes("Open Folder"));
        await editor.capture("menu");
        await editor.sendKey("Escape");

        // Ctrl+O pops the Open File dialog in the workspace folder.
        await editor.sendKey("Ctrl+O");
        await editor.waitForText((t) => t.includes("Open File") && t.includes("README.md") && t.includes(".."));
        await editor.capture("prompt");

        // Typing the start of a name highlights its row; Enter opens the file.
        await editor.sendText("READ");
        await editor.waitForText((t) => t.includes("READ") && t.includes("README.md"));
        await editor.capture("prompt-typed");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("README.md") && !t.includes("Open File"));
        await editor.capture("opened");
    },
});
