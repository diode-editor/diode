import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";


const require_ = createRequire(import.meta.url);
/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspHints");
const mainFile = resolve(sampleDir, "main.ts");

/** Key presses, not `sendText`: that goes as a bracketed paste, which doesn't count as typing, as in VS Code. */
async function type_(editor: { sendKey(name: string): Promise<void> }, text: string): Promise<void> {
    for (const char of text) await editor.sendKey(char);
}

export default defineScenario({
    name: "parameter-hints",
    title: "Stock typescript-language-server: parameter hints",
    open: [sampleDir, mainFile],
    // The server comes from the repo's devDeps (builtin client: docs/arch/Extensions.md, "Builtin LSP client" section).
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension host + server spawn: Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const label"));

        // The squiggle signals that the server has indexed the project; before it the provider isn't registered yet.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver (сервер готов)", timeoutMs: 120_000, intervalMs: 500 },
        );

        // The completion popup doesn't open after "(": quick suggest fires only at a word end, as in VS Code.
        await editor.sendKey("Ctrl+End");
        await type_(editor, "describe(");
        await editor.waitForText((t) => t.includes("1/2 describe(what: string): string"), { timeoutMs: 60_000 });
        await editor.capture("parameter-hints");

        // Not Escape: it would close the hint itself.
        await editor.sendKey("ArrowDown");
        await editor.waitForText((t) => t.includes("2/2 describe(what: string, times: number): string"), {
            timeoutMs: 60_000,
        });
        await editor.capture("parameter-hints-overload");
    },
});
