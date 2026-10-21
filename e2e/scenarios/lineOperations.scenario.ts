import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "line-operations",
    title: "Строчные операции: move/copy/delete line, копия строки без выделения",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        const count = (t: string, needle: string): number => t.split(needle).length - 1;
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Alt+ArrowDown");
        await editor.waitForText((t) => t.includes("Ln 2"));
        await editor.capture("move-line-down");

        await editor.sendKey("Alt+ArrowUp");
        await editor.waitForText((t) => t.includes("Ln 1"));

        await editor.sendKey("Ctrl+Shift+Alt+ArrowDown");
        await editor.waitForText((t) => count(t, "// fixture") === 2);
        await editor.capture("copy-line-down");

        // On the harness's legacy terminal Ctrl+Shift+K is indistinguishable from Ctrl+K,
        // so the Ctrl+K Ctrl+K chord fallback applies.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+K");
        await editor.waitForText((t) => count(t, "// fixture") === 1);
        await editor.capture("delete-line");

        // Ctrl+V without a selection inserts the line above the cursor line, as VS Code's line paste does.
        await editor.sendKey("Ctrl+C");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+V");
        await editor.waitForText((t) => count(t, "const greeting") === 2);
        await editor.capture("paste-copied-line");
    },
});
