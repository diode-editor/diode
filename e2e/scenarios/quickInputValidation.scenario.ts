import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Флейвор InputBox у общего пикера: заголовок врезан в рамку, под строкой
// запроса — сообщение валидации. Кадр держит выравнивание: запрос и сообщение
// начинаются в одной колонке, а длинное сообщение обрезается по тому же правому
// отступу, что и строки списка (см. quickOpen.scenario.ts для списочного вида).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "quick-input-validation",
    title: "InputBox с ошибкой валидации (Open File)",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Палитра команд → Open File: промпт открывается пустым.
        await editor.sendKey("Ctrl+P");
        await editor.waitForText((t) => t.includes("Go to File"));
        await editor.sendText(">open file");
        await editor.waitForText((t) => t.includes("Open File"));
        await editor.capture("palette");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Enter a file path"));

        // Несуществующий путь — под строкой запроса появляется ошибка.
        await editor.sendText("definitely-missing.txt");
        await editor.waitForText((t) => t.includes("File does not exist"));
        await editor.capture("error");
    },
});
