import { createRequire } from "node:module";

import { compositeOver, packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import { beforeAll, describe, expect, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findTextCell, frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Stock Error Lens from the marketplace, version not pinned (docs/TESTING.md). The frame is the oracle.
 * - It decorates only the lines around `TextEditor.visibleRanges` (± 100) and redraws on
 *   `onDidChangeTextEditorVisibleRanges`; without the member it threw on `visibleRanges[0]` and drew nothing.
 * - On its defaults the diagnostic is drawn after the code as Error Lens sends it, its `margin: 0 0 0 4ch` four
 *   blank cells off the code.
 */

const require_ = createRequire(import.meta.url);

const LINE_COUNT = 400;
const ERRORS = Array.from({ length: LINE_COUNT }, (_, i) => `const v${String(i)}: number = "x${String(i)}";\n`).join(
    "",
);
const MESSAGE = "is not assignable to type 'number'";

const CODE = "let a = 1 let b = 2;";

function cellAt(frame: GridSnapshot, x: number, y: number) {
    return frame.cells[y * frame.cols + x];
}

/** Dark Modern `editor.background`, and the errorlens `contributes.colors` defaults for dark themes. */
const EDITOR_BG = packRgb(0x1f, 0x1f, 0x1f);
const ERROR_BACKGROUND = compositeOver(packRgba(0xe4, 0x54, 0x54, 0x1b), EDITOR_BG);
const ERROR_FOREGROUND = packRgb(0xff, 0x64, 0x64);

/** The cell `offset` columns after the first occurrence of `needle`. */
function cellAfter(frame: GridSnapshot, needle: string, offset: number) {
    const pos = findTextCell(frame, needle);
    if (pos === null) throw new Error(`"${needle}" is not on screen:\n${frameToText(frame)}`);
    return cellAt(frame, pos.x + offset, pos.y);
}

// Linux only: the extension host and the language server are spawned (docs/TODO/E2E.md).
describe.skipIf(process.platform !== "linux" || MARKETPLACE_OFFLINE)("SEA binary — stock Error Lens", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it(
        "messages stand at the visible lines, and at new ones after a scroll to the end",
        { timeout: 240_000 },
        async () => {
            const { session } = await useHeadlessApp({
                files: { "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }), "errors.ts": ERRORS },
                settings: {
                    "errorLens.maxInlineMessages": 5,
                    "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
                    "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
                },
                installVsix: ["usernamehw.errorlens"],
                open: ["errors.ts"],
            });

            await session.waitForText((t) => t.includes(`"x0";    Type 'string' ${MESSAGE}`), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });

            await session.key("Ctrl+End");
            await session.waitForText((t) => t.includes(`"x${String(LINE_COUNT - 1)}";    Type 'string' ${MESSAGE}`), {
                timeoutMs: 30_000,
            });
        },
    );

    it(
        "[api:window.createTextEditorDecorationType] the message stands 4 blank cells off the code",
        { timeout: 180_000 },
        async () => {
            const app = await useHeadlessApp({
                files: { "src/a.ts": `${CODE}\n` },
                installVsix: ["usernamehw.errorlens"],
                open: [".", "src/a.ts"],
                cols: 120,
                rows: 20,
            });
            await app.session.waitForReady();
            const frame = await app.session.waitForText((t) => t.includes("expected"), { timeoutMs: 90_000 });
            const code = findTextCell(frame, CODE);
            if (code === null) throw new Error(`the code is not on screen:\n${frameToText(frame)}`);
            const gap = code.x + CODE.length;
            for (let x = gap; x < gap + 4; x++) expect(cellAt(frame, x, code.y).char, `gap cell ${x}`).toBe(" ");
            expect(cellAt(frame, gap + 4, code.y).char).not.toBe(" ");
        },
    );

    it(
        "the line is tinted with errorLens.errorBackground, the message in errorLens.errorForeground",
        { timeout: 240_000 },
        async () => {
            const { session } = await useHeadlessApp({
                files: { "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }), "errors.ts": ERRORS },
                settings: {
                    "errorLens.maxInlineMessages": 5,
                    "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
                    "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
                },
                installVsix: ["usernamehw.errorlens"],
                open: ["errors.ts"],
            });

            // The second line: the first one is under the cursor; `const` is skipped — the word under the cursor
            // highlights its occurrences.
            const frame = await session.waitForText((t) => t.includes(`"x1";    Type 'string' ${MESSAGE}`), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });
            expect(cellAfter(frame, "const v1:", "const ".length).bg).toBe(ERROR_BACKGROUND);
            const message = cellAfter(frame, `"x1";    Type`, `"x1";    `.length);
            expect(message.fg).toBe(ERROR_FOREGROUND);
            expect(message.bg).toBe(ERROR_BACKGROUND);
        },
    );
});
