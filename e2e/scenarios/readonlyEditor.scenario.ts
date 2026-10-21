import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The command is on Alt+R, not run from the command palette: the palette would return focus to the menu bar, typing
// would never reach the editor, and the "input blocked" frame would look right while proving nothing.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

/** nf-cod-lock — the read-only tab marker, see tuidom/ui/editorgroup/editorTabItemElement.ts. */
const LOCK = "\uea75";

export default defineScenario({
    name: "readonly-editor",
    title: "Read-only editor: lock on the tab and blocked input",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    userKeybindings: [{ key: "alt+r", command: "workbench.action.files.toggleActiveEditorReadonlyInSession" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("writable");

        await editor.sendKey("Alt+R");

        await editor.waitForText((t) => t.includes(LOCK));
        await editor.capture("readonly-tab");

        await editor.sendText("ZZZ");
        await editor.sendKey("Backspace");
        await editor.capture("typing-blocked");

        // Control for the previous step: the same typing must now reach the document — otherwise "blocked"
        // is indistinguishable from lost focus.
        await editor.sendKey("Alt+R");
        await editor.waitForText((t) => !t.includes(LOCK));
        await editor.sendText("ZZZ");
        await editor.waitForText((t) => t.includes("ZZZ"));
        await editor.capture("writable-again");
    },
});
