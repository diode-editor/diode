import { defineScenario, repoRoot } from "./framework.ts";

// Несколько терминалов во вкладке TERMINAL (как terminal tabs в VS Code):
// второй и третий шелл, список вкладок справа, переключение кликом по строке,
// kill клавишей Delete в списке и возврат имени активного терминала в
// заголовок, когда шелл остался один.
//
// Команды висят на F-клавишах (userKeybindings): в legacy-tier headless-терминала
// Ctrl+` и Ctrl+Shift+\ не кодируются, а маршрут через меню-бар оставляет фокус
// в меню — ввод не дошёл бы до шелла. Маркеры в выводе разорваны пустой
// подстановкой (`""`), чтобы целиком встретиться только в выводе шелла.

const rowOf = (n: number): string => `#terminalTab-${n}`;

export default defineScenario({
    name: "terminal-tabs",
    title: "Integrated terminal: several shells, tabs list, switch and kill",
    open: [repoRoot],
    cols: 120,
    rows: 32,
    env: {
        SHELL: "/bin/bash",
        PS1: "diode$ ",
        PROMPT_COMMAND: "",
    },
    userKeybindings: [
        { key: "f6", command: "workbench.action.terminal.toggleTerminal" },
        { key: "f7", command: "workbench.action.terminal.new" },
        { key: "f8", command: "workbench.action.terminal.focusTabs" },
    ],
    // node-pty — только Unix в текущей упаковке (как у terminal.scenario.ts).
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));

        // Первый шелл: списка нет, имя активного терминала — в заголовке вкладки.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("TERMINAL"));
        await editor.sendText('echo shell""-one');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("shell-one"));
        await editor.capture("single");

        // Ещё два — справа появляется список из трёх вкладок.
        await editor.sendKey("F7");
        await editor.sendKey("F7");
        await editor.waitForNode(rowOf(3));
        await editor.sendText('echo shell""-three');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("shell-three"));
        await editor.capture("three-tabs");

        // Клик по первой строке — на экране снова первый шелл.
        await editor.clickNode(rowOf(1));
        await editor.waitForText((t) => t.includes("shell-one") && !t.includes("shell-three"));
        await editor.capture("switched");

        // Фокус в список и Delete — первый шелл убит, в списке два.
        // Клавиши доходят по порядку: Delete обработается уже в списке.
        await editor.sendKey("F8");
        await editor.sendKey("Delete");
        // Активным стал второй шелл — вывода первого на экране больше нет.
        await editor.waitForText((t) => !t.includes("shell-one"));
        await editor.capture("killed");

        // Ещё Delete — шелл остался один: список прячется, имя уходит в заголовок.
        await editor.sendKey("Delete");
        await editor.waitForNode("#terminalActiveTab");
        await editor.capture("back-to-single");
    },
});
