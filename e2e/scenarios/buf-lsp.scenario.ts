import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Protocol Buffers from the marketplace: the REAL stock bufbuild.vscode-buf is installed FROM THE MARKETPLACE (the latest
// published version, install by id) and downloads the buf binary from GitHub itself — exactly the user's path with no
// buf on PATH. The demo covers the visible part: a squiggle on a type typo, a hover with the message's doc comment, F12
// to the declaration and completion of a field type.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "protoSample");
const mainFile = resolve(sampleDir, "demo.proto");

/** A squiggle is drawn as undercurl (StyleFlags.Undercurl === 8): the "server is up" signal. */
const UNDERCURL = 8;

function occurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

export default defineScenario({
    name: "buf-lsp",
    title: "Protocol Buffers from the marketplace: buf LSP — squiggle, hover, F12, completion",
    open: [sampleDir, mainFile],
    installVsix: ["bufbuild.vscode-buf"],
    network: true,
    cols: 100,
    rows: 28,
    // Extension host scenarios run a subprocess and a native server: Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Usr broken"));

        // Wait until the extension downloads buf and the server checks the open file.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle from buf", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // The caret on `User` in `rpc Get(User)` (line 15, column 11) → hover (Ctrl+K Ctrl+U): one doc comment is in
        // the buffer, the second one in the popup.
        for (let i = 0; i < 15; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 11; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+U");
        await editor.waitForText((t) => occurrences(t, "A user of the demo service.") >= 2, { timeoutMs: 60_000 });
        await editor.capture("hover");

        // F12 goes to `message User` (line 7 in the status bar).
        await editor.sendKey("Escape");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes("Ln 7,"), { timeoutMs: 60_000 });
        await editor.capture("definition");

        // The empty line in the body of `User` → typing `us` key by key: a popup with the message type from the server
        // (the item is `User` with the frame on the right; left of the label is a codicon glyph, not a space).
        for (let i = 0; i < 5; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey("u");
        await editor.sendKey("s");
        await editor.waitForText((t) => /User\s+│/.test(t), { timeoutMs: 60_000 });
        await editor.capture("completion");
    },
});
