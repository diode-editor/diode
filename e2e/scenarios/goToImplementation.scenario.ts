import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

export default defineScenario({
    name: "go-to-implementation",
    title: "Go to Implementations: Ctrl+F12 on an interface method lists both classes in the References panel",
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        // The squiggle in main.ts says tsserver has loaded the project.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );

        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText("shapes.ts");
        await editor.waitForText((t) => t.includes("shapes.ts"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("export interface Shape"));

        // `area` in the interface (line 1, column 4).
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 4; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+F12");
        await editor.waitForText((t) => t.includes("Implementations") && t.includes("2 results in 1 file"), {
            timeoutMs: 60_000,
        });
        await editor.capture("two-implementations");

        // Enter on the active row opens the first class's method.
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("return 3"), { timeoutMs: 10_000 });
        await editor.capture("target-opened");
    },
});
