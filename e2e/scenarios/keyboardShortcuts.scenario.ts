import { defineScenario, repoRoot } from "./framework.ts";

// Вкладка Keyboard Shortcuts: таблица команд с биндингами (Command | Keybinding
// | When | Source), поиск, рекордер комбинаций и конфликт-детекция.
//
// keybindings.json засеян конфликтным правилом (пользовательский selectAll на
// Ctrl+S поверх дефолтного save), чтобы кадр @conflicts был содержателен.
// Открытие вкладки — F6-биндом: настоящий Ctrl+K Ctrl+S headless-DSL надёжно не
// кодирует (как F6 у extensions-сценария).

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

        // Поиск: команда открытия фокусирует строку поиска, ввод сужает список.
        await editor.sendText("Show Hover");
        await editor.waitForText((t) => t.includes("Show Hover"));
        await editor.capture("filter");

        // Конфликты: очистить поиск (фокус ещё в строке) и показать группу Ctrl+S.
        for (let i = 0; i < "Show Hover".length; i++) await editor.sendKey("Backspace");
        await editor.sendText("@conflicts ctrl+s");
        await editor.waitForText((t) => t.includes("Select All") && t.includes("Save"));
        await editor.capture("conflicts");

        // Рекордер: активировать строку и нажать комбинацию (без принятия — кадр
        // показывает накопленный чорд и подсказку). Делаем последним: рекордер
        // уводит фокус на список.
        await editor.clickNode("#kb-0");
        await editor.clickNode("#kb-0");
        await editor.waitForText((t) => t.includes("Press desired key combination"));
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("F9"));
        await editor.capture("recorder");
    },
});
