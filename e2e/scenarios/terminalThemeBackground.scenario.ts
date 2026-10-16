import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

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
        const prompt = `${basename(sampleDir)}$`;
        await editor.waitForText((t) => t.includes(prompt));

        // Пустая ячейка под приглашением — фон терминала, не панели вокруг.
        const frame = await editor.captureFrame();
        const promptIndex = frame.cells.findIndex(
            (_, i) =>
                frame.cells
                    .slice(i, i + prompt.length)
                    .map((c) => c.char)
                    .join("") === prompt,
        );
        if (promptIndex === -1) throw new Error("приглашение шелла не найдено в кадре");
        const below = frame.cells[promptIndex + frame.cols * 2];
        if (below?.bg !== MOCHA_BASE) {
            throw new Error(`фон терминала ${String(below?.bg?.toString(16))}, ожидался фон панели Mocha 1e1e2e`);
        }
        await editor.capture("mocha");
    },
});
