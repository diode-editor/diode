import { defineScenario, repoRoot } from "./framework.ts";

// keybindings.json засеян конфликтом (selectAll на Ctrl+S поверх save) для кадра @conflicts. Открытие —
// F6-биндом: Ctrl+K Ctrl+S headless-DSL надёжно не кодирует.

export default defineScenario({
    name: "keyboard-shortcuts",
    title: "Keyboard Shortcuts: таблица биндингов, рекордер и конфликты",
    open: [repoRoot],
    userKeybindings: [
        { key: "f6", command: "workbench.action.openGlobalKeybindings" },
        { key: "ctrl+s", command: "editor.action.selectAll" },
    ],
    cols: 110,
    rows: 30,
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Keyboard Shortcuts") && t.includes("Keybinding"));
        await editor.capture("tab");

        await editor.sendText("Show Hover");
        await editor.waitForText((t) => t.includes("Show Hover"));
        await editor.capture("filter");

        for (let i = 0; i < "Show Hover".length; i++) await editor.sendKey("Backspace");
        await editor.sendText("@conflicts ctrl+s");
        await editor.waitForText((t) => t.includes("Select All") && t.includes("Save"));
        await editor.capture("conflicts");

        // Рекордер — последним: он уводит фокус на список.
        await editor.clickNode("#kb-0");
        await editor.clickNode("#kb-0");
        await editor.waitForText((t) => t.includes("Press desired key combination"));
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("F9"));
        await editor.capture("recorder");
    },
});
