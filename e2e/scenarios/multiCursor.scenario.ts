import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Мультикурсор: каретки, добавленные Ctrl+Alt+↓ и Alt+кликом. Аппаратный курсор
// терминала физически один, поэтому все каретки рисуются ячейками — инверсным блоком
// цветов `editorCursor.foreground`/`editorCursor.background`. Кадр — единственный способ
// увидеть, что вторичные каретки вообще есть: в модели они были бы и без отрисовки
// (`gridToSvg` аппаратный курсор в PNG не переносит вовсе).
//
// Про Alt+клик: многие терминалы и оконные менеджеры забирают его себе (тащат окно), так
// что в живом окружении жест доступен не всегда — в сценарии клик идёт через инспектор.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "multi-cursor",
    title: "Мульти-курсор: Ctrl+Alt+↓, печать во все каретки, Alt+клик",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("editor");

        // Три каретки в колонку: пачка растёт вниз, статус-бар считает выделения.
        await editor.sendKey("Ctrl+Alt+ArrowDown");
        await editor.sendKey("Ctrl+Alt+ArrowDown");
        await editor.waitForText((t) => t.includes("(3 selections)"));
        await editor.capture("cursors-below");

        // Печать идёт во все каретки сразу — три строки получают один и тот же префикс.
        await editor.sendKey("/");
        await editor.sendKey("/");
        await editor.waitForText((t) => t.includes("// fixture"));
        await editor.capture("typed-into-all");

        // Escape схлопывает набор до первичной каретки.
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("selections)"));

        // Alt+клик ставит вторую каретку в точку клика.
        await editor.clickNode("EditorElement", { altKey: true, dx: 12, dy: 4 });
        await editor.waitForText((t) => t.includes("(2 selections)"));
        await editor.capture("alt-click");
    },
});
