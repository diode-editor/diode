import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/** The assertion waits for text that is NOT in the buffer: the "weak assertion" pitfall (docs/TODO/Suggest.md). */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
// Type error, for the squiggle (readiness).
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

const UNDERCURL = 8;

// Linux only: extension host + language server spawn (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — hover от стокового typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("Ctrl+K Ctrl+U показывает тип символа, Escape закрывает попап", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "defs.ts": DEFS_TS,
                    "main.ts": MAIN_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            // A squiggle from tsserver is the readiness signal that the server indexed the project.
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // Cursor on `greet` in the call (line 2, column 23), then Ctrl+K Ctrl+U.
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 23; i++) await session.key("ArrowRight");
            await session.key("Ctrl+K");
            await session.key("Ctrl+U");

            // `(alias) greet(name: string): string` is not in the main.ts buffer.
            await session.waitForText((text) => text.includes("(alias) greet(name: string): string"), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });

            // The line is intact: neither the chord nor Escape leaked into the editor.
            await session.key("Escape");
            const frame = await waitUntil(
                () => session.captureFrame(),
                (f) => !frameToText(f).includes("(alias) greet"),
                { describe: "hover-попап закрыт по Escape", timeoutMs: 30_000, intervalMs: 250 },
            );
            expect(frameToText(frame)).toContain('const reply: number = greet("world");');
        });
    },
);
