import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

async function typeText(editor: { sendKey(name: string): Promise<void> }, text: string): Promise<void> {
    for (const ch of text) {
        await editor.sendKey(ch);
    }
}

export default defineScenario({
    name: "find",
    title: "Find-in-file (Ctrl+F) with match counter and «No results»",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("editor");

        // "greeting" matches twice: the declaration and the return.
        await editor.sendKey("Ctrl+F");
        await typeText(editor, "greeting");
        await editor.waitForText((t) => t.includes("of 2"));
        await editor.capture("find-matches");

        for (let i = 0; i < "greeting".length; i++) {
            await editor.sendKey("Backspace");
        }
        await typeText(editor, "zzz");
        await editor.waitForText((t) => t.includes("No results"));
        await editor.capture("find-no-results");

        // The kept query is fully selected on reopen — VS Code behaviour.
        for (let i = 0; i < "zzz".length; i++) {
            await editor.sendKey("Backspace");
        }
        await typeText(editor, "greeting");
        await editor.waitForText((t) => t.includes("of 2"));
        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+F");
        await editor.waitForText((t) => t.includes("of 2"));
        await editor.capture("find-query-selected");
    },
});
