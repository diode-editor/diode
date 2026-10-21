import { beforeAll, describe, expect, it } from "vitest";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findTextCell, frameLine, frameToText } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

// Bug "part of the file is white": rendering tokenizes only down to the bottom of the viewport, and the early
// exit on a converged end-state marked the whole tail valid — lines the tokenizer
// never touched stayed uncolored forever.

const packRgb = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;
const KEYWORD_FG = packRgb(0x56, 0x9c, 0xd6); // `const` (storage.type) in Dark+

const LINE_COUNT = 200;
const longFile = Array.from({ length: LINE_COUNT }, (_, i) => `const value${String(i)} = ${String(i)};`).join("\n");

const cellFg = (frame: GridSnapshot, x: number, y: number): number | undefined => frame.cells[y * frame.cols + x].fg;

/** A frame in which the grammar has arrived from the ext-host and colored something. */
async function waitForColouredFrame(session: HeadlessSession): Promise<GridSnapshot> {
    return waitUntil(
        () => session.captureFrame(),
        (frame) => frame.cells.some((cell) => cell.fg === KEYWORD_FG),
        { timeoutMs: 30_000, describe: "first highlighted frame", diagnose: (last) => frameToText(last as GridSnapshot) },
    );
}

/** Color of the first cell of the `needle` occurrence. */
function fgOfText(frame: GridSnapshot, needle: string): number | undefined {
    const pos = findTextCell(frame, needle);
    expect(pos, `"${needle}" not found in frame:\n${frameToText(frame)}`).not.toBeNull();
    return cellFg(frame, pos!.x, pos!.y);
}

/** Screen rows of the frame that show file code. */
function codeRows(frame: GridSnapshot): number[] {
    const rows: number[] = [];
    for (let y = 0; y < frame.rows; y++) {
        if (frameLine(frame, y).includes("const value")) rows.push(y);
    }
    return rows;
}

describe("Syntax highlighting beyond the first viewport", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("the file tail is coloured after editing the top line", async () => {
        const { session } = await useHeadlessApp({
            files: { "long.ts": longFile },
            open: ["long.ts"],
            cols: 100,
            rows: 30,
        });

        expect(fgOfText(await waitForColouredFrame(session), "const value0")).toBe(KEYWORD_FG);

        // An edit to the top line that does not change grammar state (a leading space) —
        // exactly the case that triggers the early exit on a converged end-state.
        await session.key("Ctrl+Home");
        await session.text(" ");

        // Jump to the end of the file: the tokenizer has not seen these lines yet.
        await session.key("Ctrl+End");
        const tail = await session.waitForText((t) => t.includes(`const value${String(LINE_COUNT - 1)}`));

        expect(fgOfText(tail, `const value${String(LINE_COUNT - 1)}`)).toBe(KEYWORD_FG);
    }, 120_000);

    it("an edit in the tail leaves no uncoloured lines above the cursor", async () => {
        const { session } = await useHeadlessApp({
            files: { "long.ts": longFile },
            open: ["long.ts"],
            cols: 100,
            rows: 30,
        });

        await waitForColouredFrame(session);

        await session.key("Ctrl+Home");
        await session.text(" ");
        await session.key("Ctrl+End");
        await session.text(" ");

        const frame = await session.captureFrame();
        const dump = frameToText(frame);
        const rows = codeRows(frame);
        expect(rows.length, `no code lines in frame:\n${dump}`).toBeGreaterThan(5);

        for (const y of rows) {
            const coloured = Array.from({ length: frame.cols }, (_, x) => cellFg(frame, x, y)).includes(KEYWORD_FG);
            expect(coloured, `line ${String(y)} is not highlighted:\n${dump}`).toBe(true);
        }
    }, 120_000);
});
