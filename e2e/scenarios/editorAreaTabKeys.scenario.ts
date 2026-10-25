import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Tab keys from a non-text tab (#818): focus stays in the Keyboard Shortcuts search box. Opened via an F6 binding:
// the headless DSL can't reliably encode Ctrl+K Ctrl+S.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "editor-area-tab-keys",
    title: "Ctrl+PgUp/PgDn and Ctrl+W work from Keyboard Shortcuts; the recorder still takes Ctrl+W",
    open: [repoRoot, sampleFile],
    userKeybindings: [{ key: "f6", command: "workbench.action.openGlobalKeybindings" }],
    settings: {
        // On the Windows runner the builtin TS server fails to start, and its error toast covered the frame.
        "diode.lsp.typescript.enabled": false,
    },
    cols: 110,
    rows: 28,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Keyboard Shortcuts") && t.includes("Keybinding"));
        await editor.capture("keyboard-shortcuts");

        await editor.sendKey("Ctrl+PageUp");
        await editor.waitForText((t) => t.includes("greeting") && !t.includes("Source"));
        await editor.capture("ctrl-pgup-to-file");

        await editor.sendKey("Ctrl+PageDown");
        await editor.waitForText((t) => t.includes("Source"));

        // The recorder records Ctrl+W instead of closing the tab.
        await editor.clickNode("#kb-0");
        await editor.clickNode("#kb-0");
        await editor.waitForText((t) => t.includes("Press desired key combination"));
        await editor.sendKey("Ctrl+W");
        await editor.waitForText((t) => t.includes("Ctrl+W"));
        await editor.capture("recorder-takes-ctrl-w");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("Press desired key combination"));

        await editor.sendKey("Ctrl+W");
        await editor.waitForText((t) => !t.includes("Keyboard Shortcuts") && t.includes("greeting"));
        await editor.capture("ctrl-w-closed");
    },
});
