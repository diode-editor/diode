import { basename } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// 16 ANSI-цветов встроенного терминала — из темы (`terminal.ansi*`, дефолты vscode),
// как у vscode (`terminal.integrated.colorSource: "theme"`, дефолт). Шелл печатает
// строку обычных (30–37) и строку ярких (90–97) цветов фоном; смена темы
// перекрашивает уже выведенное — кадр «light» после выбора Light Modern.
//
// Режим `"host"` (цвета хост-терминала по OSC 4/10/11) headless не показать: у
// headless-бэкенда нет терминала, который бы ответил, — палитра там та же, что у темы.

/** Восемь «плашек» фоном `<base>+i` с подписью-номером. */
function swatches(base: number): string {
    return Array.from({ length: 8 }, (_, i) => `\\033[${String(base + i)}m ${String(i)} `).join("") + "\\033[0m";
}

export default defineScenario({
    name: "terminal-colors",
    title: "Integrated terminal: ANSI colors from the color theme",
    open: [repoRoot],
    cols: 100,
    rows: 24,
    env: {
        SHELL: "/bin/bash",
        PS1: "diode$ ",
        PROMPT_COMMAND: "",
    },
    userKeybindings: [
        { key: "f8", command: "workbench.action.selectTheme" },
        { key: "f9", command: "workbench.action.terminal.toggleTerminal" },
    ],
    // node-pty спавнит настоящий PTY — как и terminal.scenario.ts, только Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("TERMINAL"));
        await editor.waitForText((t) => t.includes(`${basename(repoRoot)}$`) || t.includes("❯"));

        // Маркер собран из двух кусков: целиком он есть только в выводе, не в эхо команды.
        await editor.sendText(`printf 'ansi""-colors\\n${swatches(40)}\\n${swatches(100)}\\n'`);
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("ansi-colors") && t.includes(" 7 "));
        await editor.capture("dark");

        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("Select Color Theme"));
        await editor.sendText("Light Modern");
        await editor.waitForText((t) => t.includes("Light Modern"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("Select Color Theme"));
        await editor.capture("light");
    },
});
