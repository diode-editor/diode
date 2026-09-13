import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Python-линт и формат из коробки: НАСТОЯЩИЙ сторонний ruff ставится ИЗ
// МАГАЗИНА (платформенный vsix с нативным `ruff server` внутри — сквозной
// прогон платформенного маршрута реестра). Демо закрывает видимую часть:
// squiggle на неиспользуемом импорте, quickfix-меню с фиксами ruff и
// отформатированный буфер — текста `print("x")` в исходном файле нет.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "ruffSample");
const lintFile = resolve(sampleDir, "lint.py");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) — сигнал «сервер поднялся». */
const UNDERCURL = 8;

export default defineScenario({
    name: "ruff-lint",
    title: "Python-линт из коробки: ruff — squiggle, quickfix, формат",
    open: [sampleDir, lintFile],
    installVsix: ["charliermarsh.ruff"],
    network: true,
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("import sys"));

        // Дождаться, пока настоящий ruff отлинтит открытый файл.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от ruff", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // Каретка на строке `import sys` → quickfix-меню (Ctrl+K Ctrl+Q —
        // досягаемый везде чорд): фиксы настоящего ruff по диагностике F401.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText((t) => t.includes("Remove unused import"), { timeoutMs: 60_000 });
        await editor.capture("quickfix");

        // Escape закрывает меню → формат документа (Ctrl+K Ctrl+E): пробелы в
        // `print( "x" )` чинятся правками ruff-форматтера.
        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+E");
        await editor.waitForText((t) => t.includes('print("x")'), { timeoutMs: 60_000 });
        await editor.capture("formatted");
    },
});
