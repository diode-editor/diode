import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Демо вторичной боковой панели (Secondary Side Bar, auxiliary bar эталона):
// Ctrl+Alt+B показывает правую колонку во всю высоту — фон сайдбара, кнопка
// закрытия в таб-строке; саш на её левой колонке тянется мышью; на узком
// терминале она уступает первой, редактор держит свои 20 колонок. Контейнеров
// в ней пока нет — переносить виды в неё учит следующий шаг.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "auxiliary-bar",
    title: "Вторичная боковая панель",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Ctrl+Alt+B — часть справа, ширина по умолчанию 30 (как у сайдбара).
        await editor.sendKey("Ctrl+Alt+B");
        let part = await editor.waitForNode("#auxiliarybar");
        if (part.box.width !== 30) throw new Error(`ширина вторичной панели ${part.box.width}, ждали 30`);
        await editor.capture("shown");

        // Саш — на первой колонке части: тянем границу на 10 колонок влево.
        const sashX = part.box.x;
        const midY = part.box.y + Math.floor(part.box.height / 2);
        await editor.sendMouse({ action: "press", button: "left", x: sashX, y: midY });
        await editor.sendMouse({ action: "move", button: "left", x: sashX - 10, y: midY });
        await editor.sendMouse({ action: "release", button: "left", x: sashX - 10, y: midY });
        part = await editor.waitForNode("#auxiliarybar");
        if (part.box.width !== 40) throw new Error(`после drag ширина ${part.box.width}, ждали 40`);
        await editor.capture("resized");

        // Узкий терминал: часть ужимается первой, редактор не уже 20 колонок.
        await editor.resize(80, 32);
        part = await editor.waitForNode("#auxiliarybar");
        await editor.capture("narrow");

        // Кнопка × в таб-строке закрывает часть.
        const close = part.state?.close as { centerX: number } | null | undefined;
        const tabRow = part.state?.tabRow as number;
        if (close == null) throw new Error(`часть без кнопки закрытия: ${JSON.stringify(part.state)}`);
        await editor.click(close.centerX, tabRow);
        await editor.waitForText((t) => !t.split("\n")[1].endsWith(" × "));
        await editor.capture("closed");
    },
});
