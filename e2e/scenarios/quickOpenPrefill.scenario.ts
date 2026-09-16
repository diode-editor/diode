import { defineScenario, repoRoot } from "./framework.ts";

// args у пользовательского бинда (keybindings.json) доезжают до команды: бинд
// открывает Quick Open / палитру команд с заранее введённым текстом — строка
// ввода префиллена, список уже отфильтрован. Тест смотрит туда же, куда
// пользователь: правило сеется в настоящий keybindings.json, проверяется кадр.

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

        // F6 → Quick Open с уже введённым «sample»: список отфильтрован по нему.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("sample.ts"));
        await editor.capture("files-prefill");

        // F7 → палитра команд с префиллом после «>» (Escape закрывает прежний показ:
        // пока оверлей владеет клавиатурой, workbench-бинды подавлены).
        await editor.sendKey("Escape");
        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Keyboard Shortcuts"));
        await editor.capture("commands-prefill");
    },
});
