import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Alt+а приходит legacy-префиксом ESC (терминал шлёт только символ): движок сводит «а» к физической KeyF.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "menu-mnemonics-russian-layout",
    title: "Alt+а opens File in the Russian layout",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Alt+а");
        await editor.waitForText((t) => t.includes("New Untitled File") && t.includes("Exit"));
        await editor.capture("file-menu");

        // Alt+у — physical E — switches to Edit.
        await editor.sendKey("Alt+у");
        await editor.waitForText((t) => t.includes("Undo") && t.includes("Redo"));
        await editor.capture("edit-menu");
    },
});
