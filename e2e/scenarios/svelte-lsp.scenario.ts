import { cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SVELTE_SAMPLE_DIR } from "../../src/TestUtils/svelteFixture.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Out of the repository: inside it the server takes in the types of diode's own node_modules, and the props of a
// component drop out of completion. A real project has its own node_modules.
const sampleDir = join(tmpdir(), "diode-scenario-svelte");
const appFile = join(sampleDir, "App.svelte");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

export default defineScenario({
    name: "svelte-lsp",
    title: "Svelte from the marketplace: squiggle, inlay hints, component completion, F12 into a .ts file",
    open: [sampleDir, appFile],
    installVsix: ["svelte.svelte-vscode"],
    network: true,
    cols: 110,
    rows: 30,
    // The server reads TypeScript's settings, as in VS Code: the extension declares none of its own for these.
    settings: {
        "typescript.inlayHints.variableTypes.enabled": true,
        "typescript.inlayHints.functionLikeReturnTypes.enabled": true,
        "svelte.ask-to-enable-ts-plugin": false,
    },
    // Extension host scenarios run a subprocess and a language server — Linux only.
    skipOn: ["win32", "darwin"],
    prepare() {
        rmSync(sampleDir, { recursive: true, force: true });
        cpSync(SVELTE_SAMPLE_DIR, sampleDir, { recursive: true });
        return Promise.resolve();
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("unknownVar"));
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "the squiggle under unknownVar", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.waitForText((t) => t.includes("let count : number = 0;"), { timeoutMs: 60_000 });
        await editor.capture("diagnostics and inlay hints");

        // `<Button label="Add" on:click={increment} />`, line 14: Ctrl+Space before `/>` offers its props and events.
        await editor.sendKey("Ctrl+G");
        await editor.sendText("14:46");
        await editor.sendKey("Enter");
        await editor.sendKey("Ctrl+Space");
        await editor.waitForText((t) => t.includes("on:click") && t.includes("label: string"), { timeoutMs: 60_000 });
        await editor.capture("component completion");

        // `greet(user)`, line 13: F12 opens util.ts on the declaration.
        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+G");
        await editor.sendText("13:15");
        await editor.sendKey("Enter");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes("util.ts") && t.includes("Ln 5,"), { timeoutMs: 60_000 });
        await editor.capture("definition in util.ts");
    },
});
