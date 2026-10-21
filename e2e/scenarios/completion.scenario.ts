import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "e2e", "fixtures", "completion.txt");

function count(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
}

export default defineScenario({
    name: "completion",
    title: "Auto-suggest popup (editor keeps focus)",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("insert_final_newline"));
        await editor.capture("editor");

        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("i");
        await editor.sendKey("n");
        await editor.sendKey("d");

        // The popup repeats "indent_style" (editor line 0 + the suggestion row): >= 2 means the list is open.
        await editor.waitForText((t) => count(t, "indent_style") >= 2, { timeoutMs: 2000 });
        await editor.capture("suggest");
    },
});
