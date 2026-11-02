import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TOML_BROKEN_TAIL_LENGTH, writeTomlProject } from "../helpers/tomlProject.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Stock Even Better TOML from the marketplace: a syntax squiggle, Format Document, a hover from the file's schema,
// Go to Symbol in Editor and rename of a key.

const projectRoot = join(tmpdir(), "diode-scenario-toml");
const sample = join(projectRoot, "sample.toml");

export default defineScenario({
    name: "toml",
    title: "Even Better TOML from the marketplace: diagnostics, format, schema hover, symbols, rename",
    open: [projectRoot, sample],
    installVsix: ["tamasfe.even-better-toml"],
    network: true,
    cols: 110,
    rows: 24,
    // Extension host scenarios run a subprocess: Linux only.
    skipOn: ["win32", "darwin"],
    prepare() {
        rmSync(projectRoot, { recursive: true, force: true });
        writeTomlProject(projectRoot);
        return Promise.resolve();
    },
    async run(editor) {
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
            { describe: "undercurl from the taplo server", timeoutMs: 60_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        await editor.sendKey("Ctrl+End");
        for (let i = 0; i < TOML_BROKEN_TAIL_LENGTH; i++) await editor.sendKey("Backspace");
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.every((cell) => (cell.style & 8) === 0),
            { describe: "the squiggle gone with the broken header", timeoutMs: 30_000, intervalMs: 500 },
        );

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Format Document");
        await editor.waitForText((t) => t.includes("Format Document"), { timeoutMs: 20_000 });
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('name = "demo"'));
        await editor.capture("formatted");

        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Show Hover");
        await editor.waitForText((t) => t.includes("Show Hover"), { timeoutMs: 20_000 });
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("The package name from the schema"), { timeoutMs: 20_000 });
        await editor.capture("schema-hover");
        await editor.sendKey("Escape");

        await editor.sendKey("Ctrl+Shift+o");
        await editor.waitForText((t) => t.includes("symbols (2)"), { timeoutMs: 20_000 });
        await editor.capture("symbols");
        await editor.sendKey("Escape");

        await editor.sendKey("F2");
        await editor.waitForText((t) => t.includes("Rename Symbol"));
        await editor.sendText("title");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('title = "demo"'), { timeoutMs: 20_000 });
        await editor.capture("renamed");
    },
});
