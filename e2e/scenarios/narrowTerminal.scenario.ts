import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Инвариант вложенности (Н2): в тесном терминале ничего не вылезает за свои
// контейнеры — флексы жадно клампят детей по остатку (хвост меню-бара может
// ужаться до нуля), хит-зоны совпадают с нарисованным.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "narrow-terminal",
    title: "Тесный терминал: раскладка остаётся внутри границ (Н2)",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Ужимаем до 30×10 — меню-бар и статус-бар клампятся, не вылезая.
        await editor.resize(30, 10);
        await editor.waitForText((t) => t.includes("File"));
        await editor.capture("narrow");
    },
});
