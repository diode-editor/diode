import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/** #196. Silence where there's nothing to change (CommonJS) — in extensionHost.typescriptLsp.codeActions.test.ts. */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const ALPHA_IMPORT = 'import { alpha } from "./alpha";';
const ZETA_IMPORT = 'import { zeta } from "./zeta";';
// Imports in reverse order + a type error (undercurl-based readiness).
const MAIN_TS = `${ZETA_IMPORT}\n${ALPHA_IMPORT}\n\nconst bad: number = "oops";\n\nalpha();\nzeta();\n`;

const ALPHA_JS_IMPORT = 'import { alpha } from "./alpha.js";';
const ZETA_JS_IMPORT = 'import { zeta } from "./zeta.js";';
// Readiness — an undercurl on a reference to an undeclared name (checkJs).
const MAIN_JS = `${ZETA_JS_IMPORT}\n${ALPHA_JS_IMPORT}\n\nalpha();\nzeta();\nundeclaredName;\n`;

/** A squiggle is drawn with undercurl (StyleFlags.Undercurl === 8) over the error range. */
const UNDERCURL = 8;

// Extension-host subprocess + a spawned language server — Linux-only, like
// gotoDefinition / formatDocument (see docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — Organize Imports от стокового typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("палитра → Organize Imports пересортировывает импорты", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "alpha.ts": "export function alpha(): void {}\n",
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
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // The command goes through the command palette: the key DSL doesn't serialize Shift+Alt+O
            // (the same limitation as the format scenario).
            await session.key("Ctrl+P");
            await session.text(">Organize Imports");
            await session.waitForText((text) => text.includes("Organize Imports"), { timeoutMs: 30_000 });
            await session.key("Enter");

            const frame = await waitUntil(
                () => session.captureFrame(),
                (f) => {
                    const text = frameToText(f);
                    const alpha = text.indexOf(ALPHA_IMPORT);
                    const zeta = text.indexOf(ZETA_IMPORT);
                    return alpha >= 0 && zeta > alpha;
                },
                { describe: "импорты пересортированы правками tsserver'а", timeoutMs: 60_000, intervalMs: 500 },
            );
            expect(frameToText(frame)).toContain("alpha();");
        });

        it("в .js палитра → Organize Imports пересортировывает ES-импорты", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "jsconfig.json": JSON.stringify({ compilerOptions: { checkJs: true } }),
                    "alpha.js": "export function alpha() {}\n",
                    "zeta.js": "export function zeta() {}\n",
                    "main.js": MAIN_JS,
                },
                settings: LSP_SETTINGS,
                open: ["main.js"],
            });
            await session.waitForNode("EditorElement");

            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            await session.key("Ctrl+P");
            await session.text(">Organize Imports");
            await session.waitForText((text) => text.includes("Organize Imports"), { timeoutMs: 30_000 });
            await session.key("Enter");

            await waitUntil(
                () => session.captureFrame(),
                (f) => {
                    const text = frameToText(f);
                    const alpha = text.indexOf(ALPHA_JS_IMPORT);
                    const zeta = text.indexOf(ZETA_JS_IMPORT);
                    return alpha >= 0 && zeta > alpha;
                },
                { describe: "импорты .js пересортированы правками tsserver'а", timeoutMs: 60_000, intervalMs: 500 },
            );
        });
    },
);
