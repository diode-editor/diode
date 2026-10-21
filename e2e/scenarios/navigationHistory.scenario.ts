import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// History remembers the location, not the tab. Commands are on alt+b / alt+n: the palette and menu would take focus
// from the editor, and Alt+F is the File mnemonic.

const longFile = resolve(repoRoot, "e2e", "fixtures", "gutterWidthFolding.ts");
const otherFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "navigation-history",
    title: "Navigation history: Go Back / Go Forward",
    open: [repoRoot, otherFile, longFile],
    cols: 110,
    rows: 30,
    userKeybindings: [
        { key: "alt+b", command: "workbench.action.navigateBack" },
        { key: "alt+n", command: "workbench.action.navigateForward" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("function"));

        await editor.sendKey("Ctrl+End");
        await editor.waitForText((t) => /Ln 12[0-9], Col/u.test(t));
        await editor.capture("origin");

        // Ctrl+6 is "Alternate Editor".
        await editor.sendKey("Ctrl+6");
        await editor.waitForText((t) => t.includes("const greeting"));
        await editor.capture("jumped");

        await editor.sendKey("Alt+B");
        await editor.waitForText((t) => /Ln 12[0-9], Col/u.test(t));
        await editor.capture("back");

        // Back and Forward show in the menu only when there is somewhere to go.
        await editor.sendKey("Alt+G");
        await editor.waitForText((t) => t.includes("Back") && t.includes("Forward"));
        await editor.capture("go-menu");
        await editor.sendKey("Escape");

        await editor.sendKey("Alt+N");
        await editor.waitForText((t) => t.includes("const greeting"));
        await editor.capture("forward");
    },
});
