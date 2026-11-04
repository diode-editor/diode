import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell, frameToText } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `decoration-insertions` draws a Tailwind-shaped swatch before each `bg-red-500` (the color comes per range as
// `rgba(239.00000000000003, 68, 68, 1)`) and a GitLens/Error Lens-shaped italic `after` text at the end of each
// `let` line; the line `let b` overrides the text and the color per range. The extension sets them once: typing
// inside the line must not tear the cells off the text. The light theme switches the `after` color branch,
// `decoration-insertions.toggle` takes everything away.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-decoration-insertions-"));
const file = join(sampleDir, "sample.html");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-decoration-insertions");

const TEXT = ['<p class="bg-red-500">', "let a = 1;", "let b = 2;", ""].join("\n");

const RED_500 = packRgb(239, 68, 68);
const BLAME_DARK = packRgb(0x8a, 0x8a, 0x8a);
const BLAME_LIGHT = packRgb(0x6a, 0x6a, 0x6a);
const ERROR = packRgb(0xf1, 0x4c, 0x4c);

function cellAt(frame: GridSnapshot, x: number, y: number) {
    return frame.cells[y * frame.cols + x];
}

/** The first screen cell of `needle`. */
function locate(frame: GridSnapshot, needle: string): { x: number; y: number } {
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`"${needle}" is not on screen:\n${frameToText(frame)}`);
    return cell;
}

function expectFg(frame: GridSnapshot, needle: string, expected: number, italic: boolean): void {
    const { x, y } = locate(frame, needle);
    const cell = cellAt(frame, x, y);
    if (cell.fg !== expected) {
        throw new Error(`"${needle}": color #${cell.fg.toString(16)}, expected #${expected.toString(16)}`);
    }
    if (((cell.style & StyleFlags.Italic) !== 0) !== italic) throw new Error(`"${needle}": italic is not ${italic}`);
}

export default defineScenario({
    name: "extension-decoration-insertions",
    title: "Extension before/after decorations: Tailwind's color swatch, a GitLens-like after text, following the typing",
    seedUserData: userData,
    open: [sampleDir, file],
    cols: 80,
    rows: 12,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // J: F/E/S/V/G/H are menu bar mnemonics and O is the SS3 prefix.
    userKeybindings: [
        { key: "alt+j", command: "decoration-insertions.toggle" },
        { key: "f8", command: "workbench.action.selectTheme" },
    ],
    async prepare() {
        writeFileSync(file, TEXT);
    },
    async run(editor) {
        // Extensions come up after the first frames: wait for the cells.
        let frame = await editor.waitForText((t) => t.includes("■ bg-red-500") && t.includes("b is unused"), {
            timeoutMs: 20_000,
        });
        await editor.waitForReady();
        frame = await editor.captureFrame();
        expectFg(frame, "■ bg-red-500", RED_500, false);
        locate(frame, "let a = 1;  You, 2 days ago");
        expectFg(frame, "You, 2 days ago", BLAME_DARK, true);
        locate(frame, "let b = 2;  Error: b is unused");
        expectFg(frame, "Error: b is unused", ERROR, true);
        await editor.capture("dark");

        // Typing before the range and at the end of a line: the extension sends nothing, the cells follow the text.
        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("ArrowRight");
        await editor.sendKey("ArrowRight");
        await editor.sendText("xy");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendText(" // ok");
        frame = await editor.waitForText((t) => t.includes('<pxy class="■ bg-red-500">') && t.includes("// ok"));
        locate(frame, "let a = 1; // ok  You, 2 days ago");
        expectFg(frame, "■ bg-red-500", RED_500, false);
        await editor.capture("typed");

        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("Select Color Theme"), { timeoutMs: 20_000 });
        await editor.sendText("Light Modern");
        await editor.waitForText((t) => t.includes("Light Modern"));
        await editor.sendKey("Enter");
        frame = await editor.waitForText((t) => !t.includes("Select Color Theme"));
        for (
            let i = 0;
            i < 100 && cellAt(frame, locate(frame, "You,").x, locate(frame, "You,").y).fg !== BLAME_LIGHT;
            i++
        ) {
            await new Promise((r) => setTimeout(r, 100));
            frame = await editor.captureFrame();
        }
        expectFg(frame, "You, 2 days ago", BLAME_LIGHT, true);
        // The theme change keeps the tracked positions: the cells stay where the typing moved them.
        locate(frame, '<pxy class="■ bg-red-500">');
        locate(frame, "let a = 1; // ok  You, 2 days ago");
        await editor.capture("light");

        await editor.sendKey("Alt+j");
        frame = await editor.waitForText((t) => !t.includes("■") && !t.includes("You,") && !t.includes("unused"));
        locate(frame, '<pxy class="bg-red-500">');
        await editor.capture("cleared");
    },
});
