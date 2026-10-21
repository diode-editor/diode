import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureEslintLibrary, ESLINT_FLAT_CONFIG, linkEslintLibrary } from "../../src/TestUtils/eslintFixture.ts";
import { waitForEslintDiagnostics } from "../helpers/eslintReady.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Stock vscode-eslint doesn't bundle eslint: the library reaches the workspace via prepare (the fixture's npm
// cache + a node_modules symlink).

// The scenario saves the file, and the committed fixture must stay clean.
const sampleDir = mkdtempSync(join(tmpdir(), "diode-eslint-demo-"));
const lintFile = join(sampleDir, "app.js");

/** A "gone after the fix" / "remains" pair: no-extra-semi is fixable, no-unused-vars is not. */
const APP_JS =
    'const unused = 1;;\n\nfunction greet(name) {\n    return "hi " + name;;\n}\n\nconsole.log(greet("world"));\n';

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

export default defineScenario({
    name: "eslint-lint",
    title: "JS lint out of the box: eslint — squiggle, quickfix, fix on save",
    open: [sampleDir, lintFile],
    installVsix: ["dbaeumer.vscode-eslint"],
    settings: {
        "editor.codeActionsOnSave": { "source.fixAll": true },
    },
    network: true,
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(join(sampleDir, "eslint.config.mjs"), ESLINT_FLAT_CONFIG);
        writeFileSync(lintFile, APP_JS);
        linkEslintLibrary(sampleDir, ensureEslintLibrary());
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("const unused"));

        // Not by undercurl: the built-in TS client lints .js too, and its underlines arrive earlier.
        await waitForEslintDiagnostics({
            key: (name) => editor.sendKey(name),
            text: (value) => editor.sendText(value),
            waitForText: (predicate, opts) => editor.waitForText(predicate, opts),
        });
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle from eslint", timeoutMs: 30_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // The menu is filled by a single request with a 5 s timeout: if it hits a busy server, it stays empty forever
        // (an observed flake), so the menu is reopened rather than awaited.
        for (let attempt = 0; ; attempt++) {
            await editor.sendKey("Ctrl+K");
            await editor.sendKey("Ctrl+Q");
            try {
                await editor.waitForText((t) => t.includes("no-extra-semi"), { timeoutMs: 20_000 });
                break;
            } catch (err) {
                if (attempt >= 2) throw err;
                await editor.sendKey("Escape");
            }
        }
        await editor.capture("quickfix");

        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+S");
        await editor.waitForText((t) => !t.includes(";;"), { timeoutMs: 60_000 });
        await editor.capture("fixed-on-save");
    },
});
