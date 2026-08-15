import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Семейство команд сравнения (docs/TODO/DiffViewer.md): «File: Compare Active
// File With…» открывает пикер второй стороны (открытые вкладки + файлы
// workspace), выбор — вкладку диффа `a ↔ b`; активный файл слева. Терминал
// шире порога — кадр side-by-side.

/** Воркспейс без git: семейство File-команд от репозитория не зависит. */
function makeWorkspace(): { dir: string; leftFile: string } {
    const dir = mkdtempSync(join(tmpdir(), "diode-compare-demo-"));
    const base = [
        "export function greet(name: string) {",
        '    return "hi " + name;',
        "}",
        "",
        "export const VERSION = 1;",
        "",
    ];
    writeFileSync(join(dir, "greeting.ts"), base.join("\n"));
    writeFileSync(
        join(dir, "greeting.v2.ts"),
        base
            .join("\n")
            .replace('"hi " + name', '"hello, " + name + "!"')
            .replace("VERSION = 1", "VERSION = 2"),
    );
    return { dir, leftFile: join(dir, "greeting.ts") };
}

const { dir, leftFile } = makeWorkspace();

export default defineScenario({
    name: "compare-files",
    title: "Сравнение двух файлов: пикер и вкладка a ↔ b",
    open: [dir, leftFile],
    cols: 132,
    rows: 22,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greet"));

        // Команда — через палитру, как пользователь.
        await editor.sendKey("Ctrl+P");
        await editor.sendText(">Compare Active File With...");
        await editor.waitForText((t) => t.includes("Compare Active File With..."));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Select a file to compare with"));
        await editor.capture("picker");

        await editor.sendText("v2");
        await editor.waitForText((t) => t.includes("greeting.v2.ts"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("greeting.ts ↔ greeting.v2.ts"));
        await editor.capture("diff");
    },
});
