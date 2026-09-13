import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Сохранение с onSave-настройками (#196, хвост): НАСТОЯЩИЙ ruff из магазина +
// `editor.codeActionsOnSave: {"source.fixAll": true}` + `editor.formatOnSave`.
// Один Ctrl+S чинит файл целиком: fixAll удаляет неиспользуемый `import sys`
// (F401, safe-фикс), формат чинит `print( "x" )` → `print("x")` — и всё это
// ДО записи, на диск уходит уже поправленный текст.

// Копия фикстуры во временном каталоге: сценарий СОХРАНЯЕТ файл, и запись
// поверх коммитнутой e2e/fixtures/ruffSample испачкала бы рабочее дерево.
const sampleDir = mkdtempSync(join(tmpdir(), "diode-onsave-demo-"));
const lintFile = join(sampleDir, "lint.py");
copyFileSync(resolve(repoRoot, "e2e", "fixtures", "ruffSample", "lint.py"), lintFile);

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) — сигнал «сервер поднялся». */
const UNDERCURL = 8;

export default defineScenario({
    name: "on-save-fixes",
    title: "Сохранение прогоняет fix all и формат: codeActionsOnSave + formatOnSave",
    open: [sampleDir, lintFile],
    installVsix: ["charliermarsh.ruff"],
    settings: {
        "editor.codeActionsOnSave": { "source.fixAll": true },
        "editor.formatOnSave": true,
    },
    network: true,
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("import sys"));

        // Дождаться, пока настоящий ruff отлинтит открытый файл: значит, сервер
        // поднялся и save не упрётся в холодный старт.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от ruff", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("before-save");

        // Один Ctrl+S: fixAll удаляет `import sys`, формат чинит `print( "x" )`.
        await editor.sendKey("Ctrl+S");
        await editor.waitForText((t) => !t.includes("import sys") && t.includes('print("x")'), {
            timeoutMs: 60_000,
        });
        await editor.capture("saved");
    },
});
