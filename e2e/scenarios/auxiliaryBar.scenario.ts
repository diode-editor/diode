import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "auxiliary-bar",
    title: "Вторичная боковая панель",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Ctrl+Alt+B");
        let part = await editor.waitForNode("#auxiliarybar");
        if (part.box.width !== 30) throw new Error(`ширина вторичной панели ${part.box.width}, ждали 30`);
        await editor.capture("shown");

        // The sash is on the part's first column: drag the border 10 columns left.
        const sashX = part.box.x;
        const midY = part.box.y + Math.floor(part.box.height / 2);
        await editor.sendMouse({ action: "press", button: "left", x: sashX, y: midY });
        await editor.sendMouse({ action: "move", button: "left", x: sashX - 10, y: midY });
        await editor.sendMouse({ action: "release", button: "left", x: sashX - 10, y: midY });
        part = await editor.waitForNode("#auxiliarybar");
        if (part.box.width !== 40) throw new Error(`после drag ширина ${part.box.width}, ждали 40`);
        await editor.capture("resized");

        // Narrow terminal: the part shrinks first, the editor stays at least 20 columns wide.
        await editor.resize(80, 32);
        part = await editor.waitForNode("#auxiliarybar");
        await editor.capture("narrow");

        // The × button in the tab strip closes the part.
        const close = part.state?.close as { centerX: number } | null | undefined;
        const tabRow = part.state?.tabRow as number;
        if (close == null) throw new Error(`часть без кнопки закрытия: ${JSON.stringify(part.state)}`);
        await editor.click(close.centerX, tabRow);
        await editor.waitForText((t) => !t.split("\n")[1].endsWith(" × "));
        await editor.capture("closed");
    },
});
