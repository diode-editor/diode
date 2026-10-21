import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Рунг mac-cmd: ОС клавиатуры — keyboard.platform, Cmd — форсированная capability super.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "mac-keybindings",
    title: "Мак-раскладка: Cmd-/Option-/Ctrl-бинды на рунге mac-cmd и Keyboard Doctor",
    open: [repoRoot, sampleFile],
    settings: {
        "keyboard.platform": "mac",
        "terminal.capabilities": { "extended-keys": true, super: true },
        // На Windows-раннере встроенный TS-сервер не поднимается и тостами накрывает палитру; окружение e2e
        // гасит его только сценариям без своих настроек (appSession.ts).
        "diode.lsp.typescript.enabled": false,
    },
    userKeybindings: [{ key: "f6", command: "diode.keyboardDoctor" }],
    cols: 110,
    rows: 26,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting") && t.includes("mac-cmd"));

        await editor.sendKey("Meta+ArrowDown");
        await editor.waitForText((t) => t.includes("Ln 7, Col 1"));
        await editor.capture("cmd-down");

        await editor.sendKey("Meta+ArrowUp");
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));
        await editor.sendKey("Meta+ArrowRight");
        await editor.waitForText((t) => t.includes("Ln 1, Col 33"));

        // Не Ctrl+←: на маке его забирает Mission Control.
        await editor.sendKey("Alt+ArrowLeft");
        await editor.waitForText((t) => t.includes("Ln 1, Col 28"));
        await editor.capture("option-word-left");

        // Не Home/End: в мак-терминалах они скроллят буфер.
        await editor.sendKey("Ctrl+A");
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));
        await editor.sendKey("Ctrl+E");
        await editor.waitForText((t) => t.includes("Ln 1, Col 33"));

        await editor.sendKey("Meta+p");
        await editor.waitForText((t) => t.includes("Go to File"));
        await editor.capture("cmd-quick-open");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("Go to File"));

        await editor.sendKey("Meta+Shift+p");
        await editor.sendText("File: Save");
        await editor.waitForText((t) => t.includes("File: Save") && t.includes("⌘S"));
        await editor.capture("cmd-palette-labels");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("File: Save"));

        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Keyboard Doctor") && t.includes("рунг: mac-cmd"));
        await editor.capture("keyboard-doctor");
    },
});
