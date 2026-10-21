import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Alt+\u0430 (Cyrillic "a") arrives with a legacy ESC prefix (the terminal sends only the character): the engine maps
// it to the physical KeyF.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "menu-mnemonics-russian-layout",
    title: "Alt+Cyrillic a opens File in the Russian layout",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Alt+\u0430"); // "a"
        await editor.waitForText((t) => t.includes("New Untitled File") && t.includes("Exit"));
        await editor.capture("file-menu");

        // Alt+\u0443 (Cyrillic "u", physical E) switches to Edit.
        await editor.sendKey("Alt+\u0443"); // "u"
        await editor.waitForText((t) => t.includes("Undo") && t.includes("Redo"));
        await editor.capture("edit-menu");
    },
});
