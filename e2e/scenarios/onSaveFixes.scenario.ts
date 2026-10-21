import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// #196: a single Ctrl+S with `codeActionsOnSave` fixAll and formatOnSave writes the already-fixed text to disk.

// A copy: the scenario saves the file, and writing over e2e/fixtures/ruffSample would dirty the working tree.
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
    // Extension host scenarios run a subprocess + server spawn: Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("import sys"));

        // Wait for ruff's lint so the save doesn't hit the server's cold start.
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
