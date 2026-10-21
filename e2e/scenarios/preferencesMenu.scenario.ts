import { defineScenario, repoRoot } from "./framework.ts";

// Only the menu is captured: Ctrl+, can't be encoded through the headless terminal-input DSL;
// opening settings/keybindings is unit-tested.

export default defineScenario({
    name: "preferences-menu",
    title: "Settings / Keyboard Shortcuts in the File menu",
    open: [repoRoot],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.sendKey("Alt+F");
        await editor.waitForText((t) => t.includes("Settings") && t.includes("Keyboard Shortcuts"));
        await editor.capture("menu");
    },
});
