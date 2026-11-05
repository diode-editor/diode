import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { blendRgb, compositeOver, packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `text-decorations` paints three decoration types: the trailing spaces of `alpha   ` with Trailing Spaces'
// `rgba(255,0,0,0.3)`, the line `mine` whole-line with `merge.currentContentBackground`, and the word `themed`
// with a light/dark background and a magenta text color; `dead();` fades with a whole-line opacity of 0.4 (clangd's
// inactive region), `struck` is struck through and bold (Markdown's strikethrough). A selection shows through the
// translucent trailing background, the light theme switches the branch, `text-decorations.toggle` takes everything
// away.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-text-decorations-"));
const file = join(sampleDir, "sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-text-decorations");

const TEXT = [
    "alpha   ",
    "<<<<<<< HEAD",
    "mine",
    "=======",
    "theirs",
    ">>>>>>> branch",
    "a themed word",
    "dead();",
    "live();",
    "a struck word",
    "",
].join("\n");

const DARK_BG = packRgb(0x1f, 0x1f, 0x1f);
const TRAILING = packRgba(255, 0, 0, 77);
const MERGE = packRgba(0x40, 0xc8, 0xae, 0x33);
const MAGENTA = packRgb(0xff, 0x00, 0xff);

const COLS = 80;

function cellAt(frame: GridSnapshot, x: number, y: number) {
    return frame.cells[y * frame.cols + x];
}

/** The first screen cell of `needle`. */
function locate(frame: GridSnapshot, needle: string): { x: number; y: number } {
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`"${needle}" is not on screen`);
    return cell;
}

function expectBg(frame: GridSnapshot, x: number, y: number, expected: number, what: string): void {
    const bg = cellAt(frame, x, y).bg;
    if (bg !== expected) throw new Error(`${what}: background #${bg.toString(16)}, expected #${expected.toString(16)}`);
}

export default defineScenario({
    name: "extension-text-decorations",
    title: "Extension text decorations: Trailing Spaces' translucent background, merge-conflict's whole line, light/dark branches",
    seedUserData: userData,
    open: [sampleDir, file],
    cols: COLS,
    rows: 16,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // The sample has real conflict markers: the built-in Merge Conflict would paint the same block a second time.
    settings: { "merge-conflict.decorators.enabled": false, "merge-conflict.codeLens.enabled": false },
    // J: F/E/S/V/G/H are menu bar mnemonics and O is the SS3 prefix.
    userKeybindings: [
        { key: "alt+j", command: "text-decorations.toggle" },
        { key: "f8", command: "workbench.action.selectTheme" },
    ],
    async prepare() {
        writeFileSync(file, TEXT);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("a themed word"), { timeoutMs: 20_000 });
        await editor.waitForReady();
        let frame = await editor.captureFrame();
        const alpha = locate(frame, "alpha");
        // Extensions come up after the first frames: wait for the paint.
        for (let i = 0; i < 100 && cellAt(frame, alpha.x + 5, alpha.y).bg === DARK_BG; i++) {
            await new Promise((r) => setTimeout(r, 100));
            frame = await editor.captureFrame();
        }
        const trailing = compositeOver(TRAILING, DARK_BG);
        for (let i = 5; i < 8; i++) expectBg(frame, alpha.x + i, alpha.y, trailing, `trailing space ${i}`);
        expectBg(frame, alpha.x + 9, alpha.y, DARK_BG, "past the trailing spaces");

        const mine = locate(frame, "mine");
        const merged = compositeOver(MERGE, DARK_BG);
        expectBg(frame, mine.x, mine.y, merged, "merge line start");
        expectBg(frame, COLS - 3, mine.y, merged, "merge line right edge");
        expectBg(frame, mine.x, mine.y - 1, DARK_BG, "the line above the merge block");

        const themed = locate(frame, "themed");
        expectBg(frame, themed.x, themed.y, packRgb(0x00, 0x33, 0x66), "dark branch of themed");
        if (cellAt(frame, themed.x, themed.y).fg !== MAGENTA) throw new Error("themed is not painted magenta");

        // The same token colors on both lines: only the opacity tells them apart.
        const dead = locate(frame, "dead();");
        const live = locate(frame, "live();");
        const deadFg = cellAt(frame, dead.x, dead.y).fg;
        const expectedDead = blendRgb(cellAt(frame, live.x, live.y).fg, DARK_BG, 0.4);
        if (deadFg !== expectedDead) {
            throw new Error(`dead() fg #${deadFg.toString(16)}, expected #${expectedDead.toString(16)} (opacity 0.4)`);
        }
        const struck = locate(frame, "struck");
        const struckStyle = StyleFlags.Strikethrough | StyleFlags.Bold;
        if ((cellAt(frame, struck.x, struck.y).style & struckStyle) !== struckStyle) {
            throw new Error("struck is not struck through and bold");
        }
        if ((cellAt(frame, struck.x - 2, struck.y).style & StyleFlags.Strikethrough) !== 0) {
            throw new Error("the word before struck is struck through");
        }
        await editor.capture("dark");

        // The caret is on the first line: Shift+End selects `alpha   `.
        await editor.sendKey("Shift+End");
        await editor.waitForText(() => true);
        frame = await editor.captureFrame();
        const selected = cellAt(frame, alpha.x + 6, alpha.y).bg;
        if (selected === trailing || selected === DARK_BG) {
            throw new Error(`the selection does not show through the trailing background (#${selected.toString(16)})`);
        }
        await editor.capture("selection");
        // Collapses the selection.
        await editor.sendKey("Ctrl+Home");

        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("Select Color Theme"), { timeoutMs: 20_000 });
        await editor.sendText("Light Modern");
        await editor.waitForText((t) => t.includes("Light Modern"));
        await editor.sendKey("Enter");
        const lightBranch = packRgb(0xff, 0xd7, 0x00);
        frame = await editor.waitForText(() => true);
        for (let i = 0; i < 100 && cellAt(frame, themed.x, themed.y).bg !== lightBranch; i++) {
            await new Promise((r) => setTimeout(r, 100));
            frame = await editor.captureFrame();
        }
        expectBg(frame, themed.x, themed.y, lightBranch, "light branch of themed");
        expectBg(frame, alpha.x + 5, alpha.y, compositeOver(TRAILING, packRgb(0xff, 0xff, 0xff)), "trailing on light");
        await editor.capture("light");

        await editor.sendKey("Alt+j");
        for (let i = 0; i < 100 && cellAt(frame, alpha.x + 5, alpha.y).bg !== packRgb(0xff, 0xff, 0xff); i++) {
            await new Promise((r) => setTimeout(r, 100));
            frame = await editor.captureFrame();
        }
        expectBg(frame, alpha.x + 5, alpha.y, packRgb(0xff, 0xff, 0xff), "trailing after toggle");
        expectBg(frame, mine.x, mine.y, packRgb(0xff, 0xff, 0xff), "merge line after toggle");
        expectBg(frame, themed.x, themed.y, packRgb(0xff, 0xff, 0xff), "themed after toggle");
        await editor.capture("cleared");
    },
});
