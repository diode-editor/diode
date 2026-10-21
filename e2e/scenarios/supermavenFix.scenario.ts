import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Dogfood bug "Code action failed": the action cache evicted the fast provider's response while the menu was assembled
// from several providers (here tsserver, Supermaven and chat-panel), and there was no `<view>.focus` command.
// Hermetic — code-action-to-chat.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "quickfixSample");
const mainFile = resolve(sampleDir, "main.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-chat-panel");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

export default defineScenario({
    name: "supermaven-fix",
    title: "Fix with Supermaven: действие стокового Supermaven исполняется, вместо чата — тост",
    seedUserData: userData,
    installVsix: ["Supermaven.supermaven"],
    network: true,
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 120,
    rows: 32,
    // Extension host scenarios run a subprocess + spawn a server — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const bad"));

        // Readiness: without a diagnostic at the cursor, Supermaven offers no action of its own.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );

        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText((t) => t.includes("Fix with Supermaven") && t.includes("Fix with Chat Panel"), {
            timeoutMs: 60_000,
        });
        await editor.sendText("Fix with Supermaven");
        await editor.waitForText((t) => t.includes("Fix with Supermaven") && !t.includes("Fix with Chat Panel"));
        await editor.capture("menu");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes(`view "chat" is a webview`) && !t.includes("Code action failed"), {
            timeoutMs: 30_000,
        });
        await editor.capture("toast");
    },
});
