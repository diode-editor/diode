import { defineScenario, repoRoot } from "./framework.ts";

// Preferences entry points in the File menu: "Settings" (Ctrl+,) opens
// settings.json, "Keyboard Shortcuts" (Ctrl+K Ctrl+S) opens the shortcuts
// editor tab (see keyboardShortcuts.scenario.ts), and "Keyboard Shortcuts
// (JSON)" opens keybindings.json. The screenshot captures the menu — the
// visible surface of these entry points; the open/seed behaviour is covered by
// unit tests (Ctrl+, can't be encoded through the terminal-input DSL headless).

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
