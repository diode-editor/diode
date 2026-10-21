import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// A platform-specific vsix with a native `ruff server` — an end-to-end run of the registry's platform route.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "ruffSample");
const lintFile = resolve(sampleDir, "lint.py");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

export default defineScenario({
    name: "ruff-lint",
    title: "Out-of-the-box Python lint: ruff — squiggle, quickfix, format",
    open: [sampleDir, lintFile],
    installVsix: ["charliermarsh.ruff"],
    network: true,
    cols: 100,
    rows: 24,
    // Extension host scenarios run a subprocess + a spawned server — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("import sys"));

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "ruff undercurl squiggle", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText((t) => t.includes("Remove unused import"), { timeoutMs: 60_000 });
        await editor.capture("quickfix");

        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+E");
        await editor.waitForText((t) => t.includes('print("x")'), { timeoutMs: 60_000 });
        await editor.capture("formatted");
    },
});
