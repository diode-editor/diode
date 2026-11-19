import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// The stock typescript-language-server through vscode-languageclient sends `{ inserting, replacing }` ranges: with
// the default `editor.suggest.insertMode: "insert"` accepting `con|zzz` keeps `zzz`, Shift+Enter (the alternative
// accept) overwrites it.

const require_ = createRequire(import.meta.url);
/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

const sampleDir = mkdtempSync(join(tmpdir(), "diode-lsp-insert-mode-demo-"));
const mainFile = join(sampleDir, "main.ts");

const SOURCE = `// The squiggle under it tells the scenario the server is ready.
export const answer: number = "42";
zzz`;

export default defineScenario({
    name: "lsp-insert-mode",
    title: "Stock typescript-language-server: accept inserts without overwriting, Shift+Enter replaces",
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension host + server spawn: Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(mainFile, SOURCE);
        writeFileSync(join(sampleDir, "tsconfig.json"), '{ "compilerOptions": { "strict": true } }\n');
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("export const answer"));
        // Before the server answers, the popup shows buffer words, which have no insert/replace ranges.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "tsserver undercurl squiggle (server ready)", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.sendKey("Ctrl+End");
        await editor.sendKey("Home");

        for (const key of "cons") await editor.sendKey(key);
        // Inside a word quick suggestions stay closed, like upstream `shouldAutoTrigger`: the list is asked for.
        await editor.sendKey("Ctrl+Space");
        await editor.waitForText((t) => t.includes("console"), { timeoutMs: 60_000 });
        await editor.capture("popup");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => /cons\w+zzz/.test(t), { timeoutMs: 60_000 });
        await editor.capture("inserted");

        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes("conszzz"));
        await editor.sendKey("Ctrl+Space");
        await editor.waitForText((t) => t.includes("console"), { timeoutMs: 60_000 });
        await editor.sendKey("Shift+Enter");
        await editor.waitForText((t) => /cons\w+/.test(t) && !t.includes("zzz"), { timeoutMs: 60_000 });
        await editor.capture("replaced");
    },
});
