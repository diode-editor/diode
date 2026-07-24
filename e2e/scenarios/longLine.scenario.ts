import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Открытие файла с экстремально длинной строкой (~15 000 символов в одну строку,
// как минифицированный бандл) раньше вешало редактор намертво: `contentWidth` и
// цикл рендера прогоняли `Intl.Segmenter` по всей строке. Теперь строка режется
// на пороге STOP_RENDERING_LINE_AFTER (10 000), а горизонтальный скролл до места
// обреза показывает маркер «…».
//
// Что важно на кадрах:
//  - "at-open": файл открылся и отрисовался мгновенно, интерфейс жив;
//  - "cut-marker": уехав в конец длинной строки, видим маркер обрезки «…» —
//    рендер остановлен на пороге, как в VS Code (`stopRenderingLineAfter`).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "longLine.ts");

export default defineScenario({
    name: "long-line",
    title: "Extremely long line: capped render + truncation marker",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 20,
    async run(editor) {
        // The editor renders at all (no freeze) — the head comment is on screen.
        await editor.waitForText((t) => t.includes("minified bundle"));
        await editor.capture("at-open");

        // Move onto the giant line and jump to its end. The cursor clamps to the
        // render cap, scrolling the viewport to the cut point where the marker sits.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.waitForText((t) => t.includes("…"));
        await editor.capture("cut-marker");
    },
});
