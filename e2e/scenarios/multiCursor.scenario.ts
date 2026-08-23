import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Мультикурсор: каретки от Ctrl+D, Ctrl+Shift+L, Ctrl+Alt+↓ и Alt+клика. Аппаратный курсор
// терминала физически один, поэтому все каретки рисуются ячейками — инверсным блоком
// цветов `editorCursor.foreground`/`editorCursor.background`. Кадр здесь единственный
// свидетель: в модели каретки были бы и без отрисовки, а `gridToSvg` аппаратный курсор
// в PNG не переносит вовсе.
//
// Про Alt+клик: многие терминалы и оконные менеджеры забирают его себе (тащат окно), так
// что в живом окружении жест доступен не всегда — в сценарии клик идёт через инспектор.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "multi-cursor",
    title: "Мульти-курсор: Ctrl+D, Ctrl+Shift+L, Ctrl+Alt+↓, Alt+клик",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("editor");

        // Каретка на `const` второй строки: Ctrl+D сначала выделяет слово под ней, затем
        // добавляет следующее вхождение. На кадре видны и фоны выделений, и каретки на их
        // концах.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+D");
        await editor.sendKey("Ctrl+D");
        await editor.waitForText((t) => t.includes("(2 selections)"));
        await editor.capture("select-next-match");

        // «Выделить все вхождения» — одним жестом. Сессия харнесса поднимается на
        // legacy-терминале (см. индикатор tier в статус-баре), где `ctrl+shift+<буква>`
        // неотличим от `ctrl+<буква>` и канонический Ctrl+Shift+L выключен своим `when`.
        // Здесь работает аккорд-фолбэк — заодно кадр показывает, что он живой.
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("selections)"));
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+A");
        await editor.waitForText((t) => t.includes("(2 selections)"));
        await editor.capture("select-all-occurrences");

        // Три каретки в колонку: пачка растёт вниз, статус-бар считает выделения.
        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("Ctrl+Alt+ArrowDown");
        await editor.sendKey("Ctrl+Alt+ArrowDown");
        await editor.waitForText((t) => t.includes("(3 selections)"));
        await editor.capture("cursors-below");

        // Печать идёт во все каретки сразу — три строки получают один и тот же префикс.
        await editor.sendKey("/");
        await editor.sendKey("/");
        await editor.waitForText((t) => t.includes("//// fixture"));
        await editor.capture("typed-into-all");

        // Alt+клик ставит вторую каретку в точку клика.
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("selections)"));
        await editor.clickNode("EditorElement", { altKey: true, dx: 12, dy: 4 });
        await editor.waitForText((t) => t.includes("(2 selections)"));
        await editor.capture("alt-click");
    },
});
