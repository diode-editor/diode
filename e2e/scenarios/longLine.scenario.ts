import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Регрессия: строка ~15 000 символов вешала редактор (`Intl.Segmenter` по всей строке);
// рендер режется на STOP_RENDERING_LINE_AFTER маркером «…», как `stopRenderingLineAfter` VS Code.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "longLine.ts");

export default defineScenario({
    name: "long-line",
    title: "Extremely long line: capped render + truncation marker",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("minified bundle"));
        await editor.capture("at-open");

        // The cursor clamps to the render cap; the reveal scrolls the cut-point button fully into view.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.waitForText((t) => t.includes("Long line trimmed"));
        await editor.capture("cut-marker");
    },
});
