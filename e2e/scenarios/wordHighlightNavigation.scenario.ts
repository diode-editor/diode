import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `greeting` в фикстуре — объявление (Ln 2, Col 7) и использование (Ln 5, Col 12).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "word-highlight-navigation",
    title: "F7 / Shift+F7: переход по вхождениям слова под кареткой",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 8; i++) await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("Ln 2, Col 9"));
        await editor.capture("caret-on-word");

        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Ln 5, Col 12"));
        await editor.capture("next-highlight");

        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Ln 2, Col 7"));
        await editor.capture("next-wraps");

        await editor.sendKey("Shift+F7");
        await editor.waitForText((t) => t.includes("Ln 5, Col 12"));
        await editor.capture("previous-wraps");
    },
});
