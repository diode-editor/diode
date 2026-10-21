import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * #196. Undo after a quick fix: the server sends the removal of ONE name from an import as two
 * adjacent ranges on the same line, and Ctrl+Z must restore the line verbatim
 * (it used to come back scrambled — `import { alphazeta,  } from …`).
 */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const ZETA_IMPORT = 'import { zeta } from "./zeta";';
// Unused import (quickfix) + a type error (readiness via undercurl).
const MAIN_TS = `${ZETA_IMPORT}\n\nconst bad: number = "oops";\n\nexport const kept = 1;\n`;

// A two-name list: the quickfix on the unused `zeta` cuts the line with TWO
// adjacent ranges (", " and "zeta") — the shape that broke undo.
const BOTH_IMPORT = 'import { alpha, zeta } from "./both";';
const BOTH_IMPORT_FIXED = 'import { alpha } from "./both";';
const BOTH_TS = `${BOTH_IMPORT}\n\nalpha();\n`;

/** The squiggle is drawn as undercurl (StyleFlags.Undercurl === 8) over the error range. */
const UNDERCURL = 8;

// Extension-host subprocess + language server spawn — Linux-only, like
// organizeImports / formatDocument (see docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — Quick Fix from the stock typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("Ctrl+K Ctrl+Q → 'Remove import from …' removes the import", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noUnusedLocals: true } }),
                    "zeta.ts": "export function zeta(): void {}\n",
                    "main.ts": MAIN_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // The cursor is on the import line (opening puts it at the start of the file).
            await session.key("Ctrl+K");
            await session.key("Ctrl+Q");
            await session.waitForText((text) => text.includes("Select Code Action"), { timeoutMs: 60_000 });
            // Pin the wanted action with a filter — the item order is up to the server.
            await session.text("Remove import");
            await session.waitForText((text) => text.includes("Remove import"), { timeoutMs: 30_000 });
            await session.key("Enter");

            const frame = await waitUntil(
                () => session.captureFrame(),
                (f) => {
                    const text = frameToText(f);
                    return !text.includes("Code Actions") && !text.includes(ZETA_IMPORT) && text.includes("export const kept");
                },
                { describe: "import removed by the quickfix edit", timeoutMs: 60_000, intervalMs: 500 },
            );
            expect(frameToText(frame)).toContain('const bad: number = "oops";');
        });

        it("Ctrl+Z after the quick fix restores the import line verbatim", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noUnusedLocals: true } }),
                    "both.ts": "export function alpha(): void {}\nexport function zeta(): void {}\n",
                    "main.ts": BOTH_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            // Readiness: the server has indexed the project and underlined `zeta`.
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // Put the cursor on the `zeta` identifier in the first line (column 16).
            for (let i = 0; i < 16; i++) await session.key("ArrowRight");
            await session.key("Ctrl+K");
            await session.key("Ctrl+Q");
            await session.waitForText((text) => text.includes("Select Code Action"), { timeoutMs: 60_000 });
            await session.text("Remove unused declaration");
            await session.waitForText((text) => text.includes("Remove unused declaration"), { timeoutMs: 30_000 });
            await session.key("Enter");

            await waitUntil(
                () => session.captureFrame(),
                (f) => frameToText(f).includes(BOTH_IMPORT_FIXED),
                { describe: "quickfix removed zeta from the import list", timeoutMs: 60_000, intervalMs: 500 },
            );

            await session.key("Ctrl+Z");
            const undone = await waitUntil(
                () => session.captureFrame(),
                (f) => frameToText(f).includes(BOTH_IMPORT),
                { describe: "Ctrl+Z restored the import line", timeoutMs: 30_000, intervalMs: 250 },
            );
            // The scrambled buffer (`import { alphazeta,  } from …`) consists of the same
            // characters, so containment is not enough — also check it is absent.
            expect(frameToText(undone)).not.toContain("alphazeta");
            // Redo is not exercised here: `Ctrl+Shift+Z` cannot be expressed in the engine's
            // key DSL (serializeKey has no Ctrl+Shift+letter form). Redo is covered at the
            // command level in extensionHost.typescriptLsp.codeActions.test.ts.
        });
    },
);
