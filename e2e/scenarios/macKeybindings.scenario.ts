import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Мак-раскладка на рунге mac-cmd (kitty/ghostty/iTerm2 без tmux): ОС клавиатуры
// задана keyboard.platform, Cmd — форсированной capability super. Кадры
// показывают, что мак-дельты реально доезжают до команд: Cmd+↓/↑ — конец/начало
// документа, Cmd+→ — конец строки, Option+← — слово, Ctrl+A/E — начало/конец
// строки (подслой WinCtrl), индикатор Ln/Col — свидетель. Сегмент окружения
// в статус-баре показывает рунг, F6 открывает Keyboard Doctor.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "mac-keybindings",
    title: "Мак-раскладка: Cmd-/Option-/Ctrl-бинды на рунге mac-cmd и Keyboard Doctor",
    open: [repoRoot, sampleFile],
    settings: {
        "keyboard.platform": "mac",
        "terminal.capabilities": { "extended-keys": true, super: true },
    },
    userKeybindings: [{ key: "f6", command: "diode.keyboardDoctor" }],
    cols: 110,
    rows: 26,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting") && t.includes("mac-cmd"));

        // Cmd+↓ — в конец документа (вместо pc-шного Ctrl+End).
        await editor.sendKey("Meta+ArrowDown");
        await editor.waitForText((t) => t.includes("Ln 7, Col 1"));
        await editor.capture("cmd-down");

        // Cmd+↑ — в начало, Cmd+→ — в конец первой строки.
        await editor.sendKey("Meta+ArrowUp");
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));
        await editor.sendKey("Meta+ArrowRight");
        await editor.waitForText((t) => t.includes("Ln 1, Col 33"));

        // Option+← — на слово влево (Ctrl+← на маке забирает Mission Control).
        await editor.sendKey("Alt+ArrowLeft");
        await editor.waitForText((t) => t.includes("Ln 1, Col 28"));
        await editor.capture("option-word-left");

        // Ctrl+A / Ctrl+E — начало/конец строки (Home/End в мак-терминалах скроллят буфер).
        await editor.sendKey("Ctrl+A");
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));
        await editor.sendKey("Ctrl+E");
        await editor.waitForText((t) => t.includes("Ln 1, Col 33"));

        // Keyboard Doctor: окружение, рунг и первый шаг проверки.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Keyboard Doctor") && t.includes("рунг: mac-cmd"));
        await editor.capture("keyboard-doctor");
    },
});
