import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Отступ читается не по тексту (он уже отступлён), а по вставке: один и тот же Tab даёт 2 колонки в package.json
// и 4 — в 4-пробельном TypeScript.

const twoSpaceJson = resolve(repoRoot, "package.json");
const fourSpaceTs = resolve(repoRoot, "e2e", "fixtures", "folding.ts");

export default defineScenario({
    name: "indent-detection",
    title: "Автоопределение отступа по содержимому файла",
    open: [repoRoot, fourSpaceTs, twoSpaceJson],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes('"scripts"'));
        await editor.sendKey("Ctrl+End");
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Col 3"));
        await editor.capture("two-space-json");

        // Ctrl+Tab держит hold-сессию со списком поверх редактора; Ctrl+End её завершает — поэтому текст вкладки ждём
        // после перевода каретки.
        await editor.sendKey("Ctrl+Tab");
        await editor.sendKey("Ctrl+End");
        await editor.waitForText((t) => t.includes("const doubled"));
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Col 5"));
        await editor.capture("four-space-ts");
    },
});
