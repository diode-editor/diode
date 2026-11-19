import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// The stock typescript-language-server through vscode-languageclient sends `commitCharacters` (`.`, `,`, `;`, `(`):
// `consol` and then `.` accept `console` before the dot is typed, and the dot, a trigger character, opens the list
// of its members.

const require_ = createRequire(import.meta.url);
/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

const sampleDir = mkdtempSync(join(tmpdir(), "diode-lsp-commit-demo-"));
const mainFile = join(sampleDir, "main.ts");

const SOURCE = `// The squiggle under it tells the scenario the server is ready.
export const answer: number = "42";

`;

export default defineScenario({
    name: "lsp-commit-characters",
    title: "Stock typescript-language-server: a commit character accepts the selected item and is typed after it",
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
        // Before the server answers, the popup shows buffer words, which have no commit characters.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "tsserver undercurl squiggle (server ready)", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.sendKey("Ctrl+End");

        // Typed key by key, as a person does: the list opens on typing, not on a paste.
        for (const key of "consol") await editor.sendKey(key);
        // The source has no `console`: the only one on screen is the popup's item.
        await editor.waitForText((t) => t.includes("console"), { timeoutMs: 60_000 });
        await editor.capture("popup");

        await editor.sendKey(".");
        await editor.waitForText((t) => t.includes("console.") && t.includes("assert"), { timeoutMs: 60_000 });
        await editor.capture("committed");
    },
});
