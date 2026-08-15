import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Вкладка диффа v2 (docs/TODO/DiffEditable.md): «Git: Compare Active File with
// HEAD» открывает пару из двух НАСТОЯЩИХ редакторов — зоны-филлеры выравнивают
// стороны, unchanged свёрнут обычным фолдингом с парными плашками, маркеры
// `-`/`+` в гуттерах, intra-line декорациями. Правку НЕ сохраняем — modified
// сторона и есть живой буфер файла, дифф пересчитывается по правкам сам.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Свой репозиторий: закоммиченный файл, достаточно длинный, чтобы свёртка была видна. */
function makeRepo(): { repoDir: string; trackedFile: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-diff-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    const trackedFile = join(repoDir, "greeting.ts");
    const body = Array.from({ length: 14 }, (_, i) => `const value${String(i)} = ${String(i)};`);
    writeFileSync(trackedFile, [...body, "export function greet(name: string) {", '    return "hi " + name;', "}", ""].join("\n"));
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    return { repoDir, trackedFile };
}

const { repoDir, trackedFile } = makeRepo();

export default defineScenario({
    name: "diff-editor",
    title: "Вкладка diff: изменения файла против HEAD",
    open: [repoDir, trackedFile],
    cols: 132,
    rows: 22,
    // Нужен extension host — версию из HEAD отдаёт git-расширение.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greet"));

        // Правим предпоследнюю строку функции, не сохраняя.
        await editor.sendKey("Ctrl+End");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("End");
        await editor.sendText(" // changed");
        await editor.waitForText((t) => t.includes("// changed"));
        await editor.capture("edited");

        // Команду вызываем так же, как пользователь — через палитру: заодно видно,
        // что она в ней есть и находится по имени. Открываем Quick Open (Ctrl+P) и
        // переключаем его на команды префиксом `>`: Ctrl+Shift+P в key-DSL e2e не
        // сериализуется (то же ограничение, что у folding-сценария).
        await editor.sendKey("Ctrl+P");
        await editor.sendText(">Compare Active File with HEAD");
        await editor.waitForText((t) => t.includes("Compare Active File with HEAD"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("↔ HEAD"));
        await editor.capture("diff");

        // Дифф — текстовая поверхность: каретка ходит, текст выделяется. Ведём
        // её вниз и выделяем полторы строки, чтобы на кадре была видна
        // подсветка выделения поверх фона изменённых строк — в side-by-side
        // выделение живёт в активной (правой) колонке и не перетекает в левую.
        for (let i = 0; i < 4; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("Shift+ArrowDown");
        await editor.sendKey("Shift+End");
        await editor.capture("diff-selection");

        // Живой дифф: печать прямо в стороне правит буфер, пересчёт (debounce
        // 200) сам помечает строку изменённой парой.
        await editor.sendKey("Ctrl+End");
        await editor.sendText("export const LIVE = true;");
        await editor.waitForText((t) => {
            const line = t.split("\n").find((l) => l.includes("LIVE"));
            return line !== undefined && line.includes("+");
        });
        await editor.capture("live-typed");

        // Разворот свёрнутого куска — парный на обеих сторонах.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+J");
        await editor.waitForText((t) => !t.includes("unchanged lines"));
        await editor.capture("unfolded");

        // Inline-режим (US-22): один редактор, удалённые строки — призраки.
        await editor.sendKey("Ctrl+P");
        await editor.sendText(">Diff: Toggle Inline View");
        await editor.waitForText((t) => t.includes("Toggle Inline View"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("HEAD ↔ greeting.ts"));
        await editor.capture("inline");
    },
});
