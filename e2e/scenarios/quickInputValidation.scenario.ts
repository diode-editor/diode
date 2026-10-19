import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Сообщение проверки у общего пикера: заголовок врезан в рамку, под строкой
// запроса — сообщение. Кадр держит выравнивание: запрос и сообщение начинаются
// в одной колонке, а длинное сообщение обрезается по тому же правому отступу,
// что и строки списка (см. quickOpen.scenario.ts для списочного вида). Источник
// сообщения — диалог файлов Open File: Enter на несуществующем пути.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "quick-input-validation",
    title: "Сообщение проверки под строкой запроса (диалог Open File)",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Палитра команд → Open File: диалог в папке воркспейса.
        await editor.sendKey("Ctrl+P");
        await editor.waitForText((t) => t.includes("Go to File"));
        await editor.sendText(">open file");
        await editor.waitForText((t) => t.includes("Open File"));
        await editor.capture("palette");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Open File") && t.includes(".github"));

        // Несуществующий путь и Enter — под строкой запроса появляется ошибка.
        await editor.sendText("definitely-missing.txt");
        await editor.waitForText((t) => t.includes("definitely-missing.txt"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Please enter a path that exists."));
        await editor.capture("error");
    },
});
