import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Фон встроенного терминала в теме без `terminal.background` — фон панели, как
// у vscode (там у `terminal.background` дефолта нет, терминал в панели рисуется
// `panel.background`). Стоковая Catppuccin Mocha задаёт `panel.background`
// (`#1e1e2e`), но не цвета терминала; раньше терминал получал дефолт реестра
// `#181818` и чернел посреди панели. Тема приезжает из магазина по id.

const MOCHA_BASE = 0x1e1e2e;

const sampleDir = mkdtempSync(join(tmpdir(), "diode-terminal-theme-bg-"));
const textFile = join(sampleDir, "notes.txt");

export default defineScenario({
    name: "terminal-theme-background",
    title: "Integrated terminal: фон из темы — фон панели (Catppuccin Mocha)",
    open: [sampleDir, textFile],
    installVsix: ["Catppuccin.catppuccin-vsc"],
    network: true,
    settings: { "workbench.colorTheme": "Catppuccin Mocha" },
    cols: 100,
    rows: 24,
    env: { SHELL: "/bin/bash" },
    userKeybindings: [{ key: "f9", command: "workbench.action.terminal.toggleTerminal" }],
    // node-pty спавнит настоящий PTY — как и terminal.scenario.ts, только Linux.
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(textFile, "hello\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("hello"));
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("TERMINAL"));
        // Приглашение не ищем по тексту: путь tmpdir на раннере длинный и переносится.
        await editor.waitForText((t) => /TERMINAL[\s\S]*\$/.test(t));

        // Ячейка в правой части панели над статус-баром — пустое поле терминала, не панель вокруг.
        const frame = await editor.captureFrame();
        const cell = frame.cells[(frame.rows - 2) * frame.cols + Math.floor(frame.cols * 0.75)];
        if (cell?.bg !== MOCHA_BASE) {
            throw new Error(`фон терминала ${String(cell?.bg?.toString(16))}, ожидался фон панели Mocha 1e1e2e`);
        }
        await editor.capture("mocha");
    },
});
