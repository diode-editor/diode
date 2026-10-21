import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

async function typeText(editor: { sendKey(name: string): Promise<void> }, text: string): Promise<void> {
    for (const ch of text) {
        await editor.sendKey(ch);
    }
}

export default defineScenario({
    name: "auto-close",
    title: "Auto-closing pairs, typeover and auto-surround while typing",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        await typeText(editor, "const pair = {");
        await editor.waitForText((t) => t.includes("const pair = {}"));
        await editor.capture("autoclose-pair");

        await typeText(editor, "};");
        await editor.waitForText((t) => t.includes("const pair = {};") && !t.includes("{}}"));
        await editor.capture("typeover");

        await editor.sendKey("Home");
        for (let i = 0; i < "const ".length; i++) await editor.sendKey("ArrowRight");
        for (let i = 0; i < "pair".length; i++) await editor.sendKey("Shift+ArrowRight");
        await editor.sendKey("'");
        await editor.waitForText((t) => t.includes("const 'pair' = {};"));
        await editor.capture("auto-surround");
    },
});
