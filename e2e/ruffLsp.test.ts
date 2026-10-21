import { beforeAll, describe, expect, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { LINT_PY, RUFF_ID } from "../src/TestUtils/ruffFixture.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * The ONLY end-to-end run of the marketplace's platform-specific route: the machine's `targetPlatform`
 * entry → platform vsix → unpacking with the exec bit → spawning the native `ruff server`.
 */

const UNDERCURL = 8;

const FILES = { "lint.py": LINT_PY };

async function waitForServerReady(session: {
    captureFrame: () => Promise<{ cells: { style: number }[] }>;
}): Promise<void> {
    await waitUntil(
        () => session.captureFrame(),
        (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
        { describe: "undercurl squiggle от ruff", timeoutMs: 180_000, intervalMs: 500 },
    );
}

// Linux only: extension host + native server spawn (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin" || MARKETPLACE_OFFLINE)(
    "SEA binary — стоковый ruff.vsix (Python-линт и формат)",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("format document: Ctrl+K Ctrl+E чинит пробелы правками ruff", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [RUFF_ID],
                open: ["lint.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            const before = frameToText(await session.captureFrame());
            expect(before).toContain('print( "x" )');

            // Format Document is a chord reachable in any terminal.
            await session.key("Ctrl+K");
            await session.key("Ctrl+E");

            // This result could only come from edits by the real ruff formatter.
            await session.waitForText((text) => text.includes('print("x")'), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });
        });

        it("organize imports сортирует импорты действием source.organizeImports.ruff", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [RUFF_ID],
                open: ["lint.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            const before = frameToText(await session.captureFrame());
            expect(before.indexOf("import sys")).toBeLessThan(before.indexOf("import os"));

            // Run the command via the command palette: the key DSL cannot serialize Shift+Alt+O
            // (same limitation as in e2e/organizeImports.test.ts).
            await session.key("Ctrl+P");
            await session.text(">Organize Imports");
            await session.waitForText((text) => text.includes("Organize Imports"), { timeoutMs: 30_000 });
            await session.key("Enter");

            await waitUntil(
                () => session.captureFrame(),
                (frame) => {
                    const text = frameToText(frame);
                    const os = text.indexOf("import os");
                    const sys = text.indexOf("import sys");
                    return os >= 0 && sys > os;
                },
                { describe: "импорты пересортированы ruff'ом", timeoutMs: 60_000, intervalMs: 500 },
            );
        });
    },
);
