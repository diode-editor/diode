import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { packRgb } from "@tuidom/core/common/colorUtils";
import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell, frameToText } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `gutter-icons` decorates lines by their first word: `bar` gets GitLens's `data:` URI bar (a blue `▎`), `dot` an
// Error Lens-like SVG file (a green `●`, not the gray of its backdrop), `png` and `broken` a PNG and a missing file
// (a `●` in the line numbers' color), `ruler` only a CSS `overviewRulerColor` — a red mark on the scrollbar and
// nothing in the gutter. F9 puts a breakpoint on the `dot` line: the breakpoint's glyph covers the icon.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-gutter-icons-"));
const file = join(sampleDir, "sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-gutter-icons");

const filler = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `filler ${from + i}`);
const TEXT = [
    "plain line",
    "bar line",
    "dot line",
    "png line",
    "broken line",
    ...filler(5, 40),
    "ruler line",
    ...filler(41, 60),
    "",
].join("\n");

const BLUE = packRgb(0x00, 0xbc, 0xf2);
const GREEN = packRgb(0x2f, 0xaf, 0x64);
const RED = packRgb(0xff, 0x00, 0x00);

function cellAt(frame: GridSnapshot, x: number, y: number) {
    return frame.cells[y * frame.cols + x];
}

function locate(frame: GridSnapshot, needle: string): { x: number; y: number } {
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`"${needle}" is not on screen:\n${frameToText(frame)}`);
    return cell;
}

/** The gutter cell of the line's row holding `glyph`, searched left of the text. */
function gutterGlyph(frame: GridSnapshot, line: string, glyph: string): { x: number; y: number; fg: number } | null {
    const { x, y } = locate(frame, line);
    for (let gx = x - 1; gx >= Math.max(0, x - 10); gx--) {
        const cell = cellAt(frame, gx, y);
        if (cell.char === glyph) return { x: gx, y, fg: cell.fg };
    }
    return null;
}

async function waitForGlyph(
    editor: { captureFrame(): Promise<GridSnapshot> },
    line: string,
    glyph: string,
    accept: (fg: number) => boolean = () => true,
): Promise<GridSnapshot> {
    let frame = await editor.captureFrame();
    for (let i = 0; i < 100; i++) {
        const found = gutterGlyph(frame, line, glyph);
        if (found !== null && accept(found.fg)) return frame;
        await new Promise((r) => setTimeout(r, 100));
        frame = await editor.captureFrame();
    }
    throw new Error(`no ${glyph} in the gutter of "${line}":\n${frameToText(frame)}`);
}

export default defineScenario({
    name: "extension-gutter-icons",
    title: "Extension gutter icons: GitLens's bar, an SVG file's color, a PNG; overviewRulerColor marks only the scrollbar",
    seedUserData: userData,
    open: [file],
    cols: 80,
    rows: 16,
    // The breakpoint's glyph as the plain `●` the frame text shows.
    settings: { "diode.icons.nerdFont": "off" },
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async prepare() {
        writeFileSync(file, TEXT);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("broken line"), { timeoutMs: 20_000 });
        await editor.waitForReady();

        await waitForGlyph(editor, "bar line", "▎", (fg) => fg === BLUE);
        await waitForGlyph(editor, "dot line", "●", (fg) => fg === GREEN);
        const frame = await waitForGlyph(editor, "broken line", "●");
        for (const line of ["png line", "broken line"]) {
            const glyph = gutterGlyph(frame, line, "●");
            if (glyph === null) throw new Error(`"${line}" lost its icon`);
            // The line number sits between the glyph and the text.
            const numberFg = cellAt(frame, glyph.x + 2, glyph.y).fg;
            if (glyph.fg !== numberFg) {
                const colors = `#${glyph.fg.toString(16)}, the line number #${numberFg.toString(16)}`;
                throw new Error(`"${line}": the icon is ${colors}`);
            }
        }
        if (gutterGlyph(frame, "plain line", "●") !== null) throw new Error("an undecorated line has an icon");

        // The red mark is on the scrollbar, right of the text; no red in the gutter.
        const text = locate(frame, "plain line");
        const red = frame.cells
            .map((cell, i) => ({ cell, x: i % frame.cols }))
            .filter(({ cell }) => cell.fg === RED || cell.bg === RED);
        if (red.length === 0) throw new Error("overviewRulerColor left no mark on the scrollbar");
        if (red.some(({ x }) => x < text.x)) throw new Error("overviewRulerColor drew in the gutter");
        await editor.capture("icons");

        // The cursor on `dot line`, then F9: the breakpoint's glyph wins the lane's one cell.
        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("F9");
        await waitForGlyph(editor, "dot line", "●", (fg) => fg !== GREEN);
        await editor.capture("breakpoint-over-icon");
    },
});
