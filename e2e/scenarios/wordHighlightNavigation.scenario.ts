import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// F7 / Shift+F7 — переход по подсвеченным вхождениям слова под кареткой
// (`editor.action.wordHighlight.next/prev`). `greeting` в фикстуре встречается дважды:
// объявление (Ln 2, Col 7) и использование (Ln 5, Col 12). Каретка встаёт на начало
// вхождения, переход циклический, оба вхождения остаются подсвеченными.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "word-highlight-navigation",
    title: "F7 / Shift+F7: переход по вхождениям слова под кареткой",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Каретка внутрь `greeting` в объявлении — оба вхождения подсвечены.
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 8; i++) await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("Ln 2, Col 9"));
        await editor.capture("caret-on-word");

        // F7 — на начало следующего вхождения.
        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Ln 5, Col 12"));
        await editor.capture("next-highlight");

        // F7 с последнего — циклически на первое.
        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Ln 2, Col 7"));
        await editor.capture("next-wraps");

        // Shift+F7 с первого — циклически на последнее.
        await editor.sendKey("Shift+F7");
        await editor.waitForText((t) => t.includes("Ln 5, Col 12"));
        await editor.capture("previous-wraps");
    },
});
