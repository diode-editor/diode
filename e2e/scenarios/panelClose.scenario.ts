import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Демо пункта 10 ParityBacklog: кнопка `×` в правом конце таб-строки нижней
// панели закрывает её — ровно как `✕` в шапке панели у VS Code. Координаты
// кнопки берём из inspectState виджета, а не считаем руками: строка панели
// разделена с контролами вкладки, и пересчёт уже один раз был граблей.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "panel-close",
    title: "Кнопка закрытия нижней панели",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Ctrl+J — панель открыта, в её таб-строке видна кнопка закрытия.
        await editor.sendKey("Ctrl+J");
        const panel = await editor.waitForNode("#panel");
        await editor.capture("panel-open");

        const close = panel.state?.close as { centerX: number } | null | undefined;
        const tabRow = panel.state?.tabRow as number;
        if (close == null) throw new Error(`панель без кнопки закрытия: ${JSON.stringify(panel.state)}`);

        // Клик по `×` — панель закрылась, редактор занял её место.
        await editor.click(close.centerX, tabRow);
        await editor.waitForText((t) => !t.includes("PROBLEMS"));
        await editor.capture("panel-closed");
    },
});
