import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "svelteSample");
const appFile = resolve(sampleDir, "App.svelte");

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
    async run(editor) {
        await editor.waitForText((t) => t.includes("unknownVar"));
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "the squiggle under unknownVar", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.waitForText((t) => t.includes("let count : number = 0;"), { timeoutMs: 60_000 });
        await editor.capture("diagnostics and inlay hints");

        // `<Button label="Add" … />`, line 14: Ctrl+Space after `<Button ` offers its props and events.
        await editor.sendKey("Ctrl+G");
        await editor.sendText("14:13");
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
