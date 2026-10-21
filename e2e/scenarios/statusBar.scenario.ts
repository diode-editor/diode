import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "AGENTS.md");

export default defineScenario({
    name: "statusBar",
    title: "Status bar composed from tuidom primitives",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("Ln 1, Col 1") && t.includes("UTF-8"));
        await editor.capture("normal-width");

        const branch = await editor.waitForNode("#statusBarItem-status-scm-branch");
        await editor.sendMouse({ action: "move", button: "none", x: branch.box.x + 2, y: branch.box.y });
        await editor.capture("segment-hover");

        // Меню флипается вверх: полоса — нижний ряд.
        await editor.sendMouse({ action: "press", button: "right", x: branch.box.x + 2, y: branch.box.y });
        await editor.sendMouse({ action: "release", button: "right", x: branch.box.x + 2, y: branch.box.y });
        await editor.waitForText((t) => t.includes("Hide 'Source Control'"));
        await editor.capture("visibility-menu");
        await editor.sendKey("Escape");

        // 30, а не 40 колонок: на CI ветка `main` короткая, и при 40 обе группы влезали встык — UTF-8 не вытеснялся,
        // wait висел до таймаута. Проверяем факт вытеснения, а не обрезок: ширина левой группы плавает по имени ветки.
        await editor.resize(30, 16);
        await editor.waitForText((t) => !t.includes("UTF-8"));
        await editor.capture("narrow-overflow");
    },
});
