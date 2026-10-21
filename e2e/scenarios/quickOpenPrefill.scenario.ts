import { defineScenario, repoRoot } from "./framework.ts";

// The args of a user keybinding (keybindings.json) reach the command: the rule is seeded into a real keybindings.json.

export default defineScenario({
    name: "quick-open-prefill",
    title: "Quick Open с префиллом из args пользовательского бинда",
    open: [repoRoot],
    userKeybindings: [
        { key: "f6", command: "workbench.action.quickOpen", args: "sample" },
        { key: "f7", command: "workbench.action.showCommands", args: "keyboard" },
    ],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));

        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("sample.ts"));
        await editor.capture("files-prefill");

        // Escape: while the overlay owns the keyboard, workbench keybindings are suppressed.
        await editor.sendKey("Escape");
        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Keyboard Shortcuts"));
        await editor.capture("commands-prefill");
    },
});
