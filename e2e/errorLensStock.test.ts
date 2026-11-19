import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import { beforeAll, describe, expect, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findTextCell, frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Stock Error Lens from the marketplace on its defaults, version not pinned (docs/TESTING.md): the diagnostic of
 * the built-in TypeScript server is drawn after the code as Error Lens sends it, its `margin: 0 0 0 4ch` four
 * blank cells off the code. The frame is the oracle.
 */

const CODE = "let a = 1 let b = 2;";

function cellAt(frame: GridSnapshot, x: number, y: number) {
    return frame.cells[y * frame.cols + x];
}

describe.skipIf(process.platform === "win32" || MARKETPLACE_OFFLINE)("SEA binary — stock Error Lens", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

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

    // Error Lens paints with its own `contributes.colors` (`errorLens.errorBackground`, `errorLens.errorForeground`),
    // which Diode does not register yet: the line has no tint and the message the editor's text color.
    it.todo("the line is tinted with errorLens.errorBackground, the message in errorLens.errorForeground");
});
