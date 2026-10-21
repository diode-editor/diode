import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/** Format Document from the stock `typescript-language-server` in the SEA binary (#196). */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

// A type error — for undercurl-based readiness.
const MESSY_TS = 'const  answer :   number  =  "oops";\n\nfunction   greet( name:string ){\n        return  "hi "  +  name;\n}\n';

const UNDERCURL = 8;

// Linux only: extension host + a spawned language server (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — Format Document from stock typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("Shift+Alt+F turns messy whitespace into tsserver formatting", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "main.ts": MESSY_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            // A squiggle from tsserver is the readiness signal "the server has indexed the project".
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // A legacy terminal doesn't deliver Shift+Alt+F (ESC F without the shift flag) —
            // press the reachable chord Ctrl+K Ctrl+E, the second binding of the same command.
            await session.key("Ctrl+K");
            await session.key("Ctrl+E");
            const frame = await waitUntil(
                () => session.captureFrame(),
                (f) => frameToText(f).includes("function greet(name: string) {"),
                { describe: "tsserver formatting edits in the buffer", timeoutMs: 60_000, intervalMs: 500 },
            );

            const text = frameToText(frame);
            expect(text).toContain('const answer: number = "oops";');
            expect(text).toContain('return "hi " + name;');
        });
    },
);
