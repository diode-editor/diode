import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// #196: один Ctrl+S с `codeActionsOnSave` fixAll и formatOnSave — на диск уходит уже поправленный текст.

// Копия: сценарий сохраняет файл, а запись поверх e2e/fixtures/ruffSample испачкала бы рабочее дерево.
const sampleDir = mkdtempSync(join(tmpdir(), "diode-onsave-demo-"));
const lintFile = join(sampleDir, "lint.py");
copyFileSync(resolve(repoRoot, "e2e", "fixtures", "ruffSample", "lint.py"), lintFile);

/** StyleFlags.Undercurl. */
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

        // Дождаться линта от ruff, чтобы save не упёрся в холодный старт сервера.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от ruff", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("before-save");

        await editor.sendKey("Ctrl+S");
        await editor.waitForText((t) => !t.includes("import sys") && t.includes('print("x")'), {
            timeoutMs: 60_000,
        });
        await editor.capture("saved");
    },
});
