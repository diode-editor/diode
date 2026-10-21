import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Regression: the vscode-languageclient converter constructs `new DiagnosticRelatedInformation`
 * for every such diagnostic, and the stub lacked the class — the WHOLE batch failed and the file
 * was left without squiggles. Hence the fixture is TS2741, for which tsserver always
 * sends related information; the TS2322 of neighboring suites doesn't catch it.
 */

const require_ = createRequire(import.meta.url);
const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
    "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
};

const CONFIG_TS = "export interface Config {\n    name: string;\n    retries: number;\n}\n";
const MAIN_TS =
    'import type { Config } from "./config";\n\nexport function makeConfig(): Config {\n    return {\n        name: "demo",\n    };\n}\n';

const UNDERCURL = 8;

// Linux only: extension host + language server spawn (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — диагностика с related information (stock typescript-language-server)",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("squiggle и текст ошибки доезжают, а не теряются вместе с пачкой", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "config.ts": CONFIG_TS,
                    "main.ts": MAIN_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            // The diagnostics batch survived conversion.
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // The marker reached MarkerService, not just "something got underlined".
            await session.key("Ctrl+J");
            await session.waitForText((text) => /is missing/i.test(text), { timeoutMs: 60_000, intervalMs: 500 });

            const screen = frameToText(await session.captureFrame());
            expect(screen).toMatch(/retries/);
            expect(screen).toMatch(/main\.ts/);
        });
    },
);
