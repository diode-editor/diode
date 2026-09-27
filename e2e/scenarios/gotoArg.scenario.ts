import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `diode -g <file>:<line>:<column>` — открыть файл и сразу поставить каретку.
// Наблюдаемый результат — позиция в статус-баре («Ln N, Col M») и прокрученный
// к ней вьюпорт: без флага редактор открывается на первой строке.

// Фикстура на 128 строк — прокрутка к строке 30 видна на кадре.
const sampleFile = resolve(repoRoot, "e2e", "fixtures", "gutterWidthFolding.ts");

export default defineScenario({
    name: "goto-arg",
    title: "CLI -g file:line:column — каретка в заданной позиции",
    extraArgs: ["-g"],
    open: [`${sampleFile}:30:7`],
    cols: 120,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("Ln 30, Col 7"));
        await editor.capture("goto");
    },
});
