import { basename } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Скролбэк встроенного терминала: вывод длиннее экрана уезжает в историю, и её видно.
// Колесо мыши в инспектор-протоколе пока не инъецируется (enabler `TUIDom.sendMouse`,
// см. docs/TODO/TerminalPanelBugs.md), поэтому демо крутит вьюпорт клавиатурой —
// Shift+PageUp/PageDown ходят по тому же `surface.scrollLines`, что и колесо.
//
// Терминал открывается тем же тир-независимым путём, что и в terminal.scenario.ts:
// View-меню (Alt+V) → Command Palette → Toggle Terminal.

export default defineScenario({
    name: "terminal-scrollback",
    title: "Integrated terminal: scrollback (Shift+PageUp)",
    open: [repoRoot],
    cols: 120,
    rows: 32,
    env: {
        SHELL: "/bin/bash",
        PS1: "vexx$ ",
        PROMPT_COMMAND: "",
    },
    // node-pty спавнит настоящий PTY — как и terminal.scenario.ts, только Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Command Palette"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("File: Save"));
        await editor.sendText("Toggle Terminal");
        await editor.waitForText((t) => t.includes("Toggle Terminal"));
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("TERMINAL"));
        // Имя каталога, а не литерал "vexx": в git-worktree cwd оканчивается иначе.
        await editor.waitForText((t) => t.includes(`${basename(repoRoot)}$`) || t.includes("❯"));

        // Печатаем заведомо больше строк, чем помещается в панель: начало вывода
        // уходит в скролбэк, на экране остаётся хвост.
        await editor.sendText("seq 1 100");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("100"));
        await editor.capture("bottom");

        // Shift+PageUp листает в историю страницами. Жмём заведомо больше страниц, чем
        // есть в скролбэке: смещение клампится в самый верх — детерминированный кадр,
        // не зависящий от высоты панели. Там видно строку с самой командой.
        for (let i = 0; i < 20; i++) await editor.sendKey("Shift+PageUp");
        await editor.waitForText((t) => t.includes("seq 1 100"));
        await editor.capture("scrolled");

        // Обратно на дно — тем же перелистыванием вниз до упора.
        for (let i = 0; i < 20; i++) await editor.sendKey("Shift+PageDown");
        await editor.waitForText((t) => t.includes("100"));
        await editor.capture("back-to-bottom");
    },
});
