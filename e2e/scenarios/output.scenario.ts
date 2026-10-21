import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The channel is switched by `workbench.action.output.show.<id>`, the same path the selector takes;
// opening the list with the mouse is covered in `selectBoxElement.test.ts`. Keys are user keybindings: the palette
// returns focus to the menu bar. Not O: `ESC O` is the SS3 prefix (`ESC O P` = F1).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "output",
    title: "Output: a subsystem log in the bottom panel",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    userKeybindings: [
        { key: "alt+u", command: "workbench.action.output.toggleOutput" },
        { key: "alt+j", command: "workbench.action.output.show.extensions" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Alt+U");

        await editor.waitForText((t) => t.includes("OUTPUT"));
        await editor.waitForText((t) => t.includes("[info] diode starting"));
        await editor.waitForText((t) => t.includes("Bootstrap"));
        // No "⋯" with a "Switch Output ›" copy: an `isSelection` submenu is a SelectBox, as in VS Code.
        await editor.waitForText((t) => {
            const tabRow = t.split("\n").find((line) => line.includes("PROBLEMS  OUTPUT  TERMINAL"));
            return tabRow !== undefined && tabRow.includes("Bootstrap") && !tabRow.includes("⋯");
        });
        await editor.capture("panel");

        await editor.sendKey("Alt+J");
        await editor.waitForText((t) => t.includes("Extensions") && !t.includes("diode starting"));
        await editor.capture("channel-switched");

        // BUG-1 from review: focus was lost after switching channels; check that the cursor moves through the log.
        await editor.sendKey("ArrowUp");
        await editor.sendKey("ArrowUp");
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));
    },
});
