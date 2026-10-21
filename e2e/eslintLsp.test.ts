import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
    ensureEslintLibrary,
    ESLINT_FLAT_CONFIG,
    ESLINT_ID,
    LINT_JS,
    linkEslintLibrary,
} from "../src/TestUtils/eslintFixture.ts";
import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { waitForEslintDiagnostics } from "./helpers/eslintReady.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * The stock vscode-eslint extension from the marketplace; the eslint library lives in the workspace (the extension
 * doesn't bundle it). Assertions wait for text that is NOT in the buffer (the "weak assertion" pitfall).
 */

const UNDERCURL = 8;

// Linux only: extension host + a spawned server (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin" || MARKETPLACE_OFFLINE)(
    "SEA binary — stock vscode-eslint.vsix (JS lint, fix on save)",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("Ctrl+S with codeActionsOnSave fixes no-extra-semi in the buffer and on disk", { timeout: 300_000 }, async () => {
            // A workspace with the eslint library can't be a committed fixture
            // (node_modules) and gets saved, hence a temp directory.
            const sampleDir = mkdtempSync(join(tmpdir(), "diode-eslint-e2e-"));
            const lintFile = join(sampleDir, "lint.js");
            writeFileSync(join(sampleDir, "eslint.config.mjs"), ESLINT_FLAT_CONFIG);
            writeFileSync(lintFile, LINT_JS);
            linkEslintLibrary(sampleDir, ensureEslintLibrary());

            const { session } = await useHeadlessApp({
                open: [sampleDir, lintFile],
                installVsix: [ESLINT_ID],
                settings: { "editor.codeActionsOnSave": { "source.fixAll": true } },
            });
            await session.waitForNode("EditorElement");

            // Undercurl is a false signal: the builtin TS client lints .js too (helpers/eslintReady.ts).
            // After eslint diagnostics, save won't hit the server's cold start.
            await waitForEslintDiagnostics({
                key: (name) => session.sendKey(name),
                text: (value) => session.sendText(value),
                waitForText: (predicate, opts) => session.waitForText(predicate, opts),
            });
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle from eslint", timeoutMs: 30_000, intervalMs: 500 },
            );
            expect(frameToText(await session.captureFrame())).toContain("const unused = 1;;");

            // A single Ctrl+S: source.fixAll.eslint removes the extra `;` BEFORE writing.
            await session.key("Ctrl+S");
            await session.waitForText((text) => !text.includes(";;"), { timeoutMs: 60_000, intervalMs: 500 });

            expect(readFileSync(lintFile, "utf-8")).toBe("const unused = 1;\n");
        });
    },
);
