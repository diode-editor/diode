import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Автоопределение отступа: ширину и вид отступа редактор берёт из содержимого
// файла, а не из дефолтов `editor.tabSize` / `editor.insertSpaces`. Читается это
// не по самому тексту (он на диске уже отступлён), а по тому, что редактор
// вставляет: один и тот же Tab на пустой строке даёт 2 колонки в package.json
// и 4 — в соседней вкладке с 4-пробельным TypeScript. Индикатор — «Ln, Col» в
// статус-баре.

const twoSpaceJson = resolve(repoRoot, "package.json");
const fourSpaceTs = resolve(repoRoot, "e2e", "fixtures", "folding.ts");

export default defineScenario({
    name: "indent-detection",
    title: "Автоопределение отступа по содержимому файла",
    open: [repoRoot, fourSpaceTs, twoSpaceJson],
    cols: 120,
    rows: 32,
    async run(editor) {
        // Активна package.json — отступ 2 пробела.
        await editor.waitForText((t) => t.includes('"scripts"'));
        await editor.sendKey("Ctrl+End");
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Col 3"));
        await editor.capture("two-space-json");

        // Соседняя вкладка — 4-пробельный TypeScript. Тот же редактор, те же
        // настройки, тот же Tab: разошлись именно детекции.
        await editor.sendKey("Ctrl+Tab");
        await editor.waitForText((t) => t.includes("const doubled"));
        await editor.sendKey("Ctrl+End");
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Col 5"));
        await editor.capture("four-space-ts");
    },
});
