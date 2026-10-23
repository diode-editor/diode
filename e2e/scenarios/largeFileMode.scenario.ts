import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell, frameToText } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// The large-file mode (docs/arch/Editor.md, docs/TODO/OpenPerformance.md 4.1): above 20 MB / 300K lines the file
// opens read-only with the heavy features off, a toast says so, and its button "Enable Editing" gives both back.
// F6 is `notifications.focusMessage`; Enter presses the focused (first) button of the toast.

/** 400K lines of ~56 bytes: above both thresholds (22 MB, 300K lines). */
const LINES = 400_000;
const dir = join(tmpdir(), "diode-scenario-large-file-mode");
const file = join(dir, "large-mode.ts");

/** nf-cod-lock — the read-only tab marker, see tuidom/ui/editorgroup/editorTabItemElement.ts. */
const LOCK = "";
const FIRST_LINE = "export const largeFileMarker = 42;";

function generate(): string {
    const lines: string[] = [FIRST_LINE];
    for (let i = 1; i < LINES; i++) {
        lines.push(`export const value${String(i)} = ${String(i)}; // sample line with a comment tail`);
    }
    return lines.join("\n") + "\n";
}

/** Foreground of the `export` keyword and of the `largeFileMarker` identifier on the first line. */
function firstLineColors(frame: GridSnapshot): { keyword: number; identifier: number } | null {
    const cell = findTextCell(frame, FIRST_LINE);
    if (cell === null) return null;
    const at = (x: number) => frame.cells[cell.y * frame.cols + x].fg;
    return { keyword: at(cell.x), identifier: at(cell.x + "export const ".length) };
}

export default defineScenario({
    name: "large-file-mode",
    title: "Large file: read-only with features off, the toast's button enables editing",
    open: [file],
    cols: 120,
    rows: 32,
    prepare() {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, generate());
        return Promise.resolve();
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes(FIRST_LINE) && t.includes("Enable Editing"));
        await editor.waitForText((t) => t.includes(LOCK));
        await editor.capture("readonly-toast");

        // Typing is blocked, and the keyword is not colored: no tokenizer on a large file.
        await editor.sendText("ZZZ");
        const blocked = await editor.captureFrame();
        if (frameToText(blocked).includes("ZZZ")) throw new Error("typing reached the read-only large file");
        const plain = firstLineColors(blocked);
        if (plain === null || plain.keyword !== plain.identifier) {
            throw new Error(`the large file is highlighted: ${JSON.stringify(plain)}`);
        }
        await editor.capture("typing-blocked");

        // The toast's button: the tab leaves read-only and the features come back.
        await editor.sendKey("F6");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes(LOCK) && !t.includes("Enable Editing"));
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => {
                const colors = firstLineColors(frame);
                return colors !== null && colors.keyword !== colors.identifier;
            },
            { describe: "the first line is highlighted after Enable Editing", diagnose: (last) => frameToText(last as GridSnapshot) },
        );
        await editor.capture("editing-enabled");

        await editor.sendText("ZZZ");
        await editor.waitForText((t) => t.includes("ZZZ"));
        await editor.capture("typing-works");
    },
});
