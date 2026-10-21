import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Строки ~140 символов при cols: 80. Полоска — нижний half-block `▄`, а не `▀`; фон строки — фон редактора
// (`setCell` передаёт bg, а не полагается на patch-семантику Grid).

const wideFile = resolve(repoRoot, "e2e", "fixtures", "wide.ts");

export default defineScenario({
    name: "horizontal-scrollbar",
    title: "Editor horizontal scrollbar (bottom edge, opaque, themed)",
    open: [repoRoot, wideFile],
    cols: 80,
    rows: 16,
    async run(editor) {
        await editor.waitForText((t) => t.includes("veryLongLine"));
        await editor.capture("at-start");

        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.waitForText((t) => t.includes("mu: 12"));
        await editor.capture("scrolled-right");
    },
});
