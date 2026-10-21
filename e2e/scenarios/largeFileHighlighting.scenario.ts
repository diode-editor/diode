import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell, frameToText } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";
import { defineScenario } from "./framework.ts";

const BLOCKS = 10_000; // 6 lines per block, 60k lines
const dir = join(tmpdir(), "diode-scenario-large-file");
const file = join(dir, "large.ts");

function generate(): string {
    const lines: string[] = [];
    for (let i = 0; i < BLOCKS; i++) {
        lines.push(
            `// block ${String(i)}`,
            `export function f${String(i)}(value: number): string {`,
            `    const text = "line " + value;`,
            `    return text.repeat(2);`,
            `}`,
            ``,
        );
    }
    return lines.join("\n");
}

/** Color of `export` in `export function f<n>`: the keyword color once the line is highlighted. */
function exportFg(frame: GridSnapshot, block: number): number | undefined {
    const cell = findTextCell(frame, `export function f${String(block)}(`);
    return cell === null ? undefined : frame.cells[cell.y * frame.cols + cell.x].fg;
}

/** Color of `value` (a parameter, not a keyword) on the same line. */
function valueFg(frame: GridSnapshot, block: number): number | undefined {
    const needle = `export function f${String(block)}(`;
    const cell = findTextCell(frame, needle);
    return cell === null ? undefined : frame.cells[cell.y * frame.cols + cell.x + needle.length].fg;
}

export default defineScenario({
    name: "large-file-highlighting",
    title: "Large file: Ctrl+End and the middle are highlighted at once",
    open: [file],
    cols: 100,
    rows: 24,
    prepare() {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, generate());
        return Promise.resolve();
    },
    async run(editor) {
        // Top of file: the keyword gets a color different from the identifier.
        const top = await waitUntil(
            () => editor.captureFrame(),
            (frame) => exportFg(frame, 0) !== undefined && exportFg(frame, 0) !== valueFg(frame, 0),
            { describe: "top of the file is highlighted", diagnose: (last) => frameToText(last as GridSnapshot) },
        );
        const keyword = exportFg(top, 0);
        await editor.capture("top");

        // End of file is keyword-colored at once, although background tokenization hasn't reached it yet.
        await editor.sendKey("Ctrl+End");
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => exportFg(frame, BLOCKS - 1) === keyword,
            { describe: "end of the file is highlighted", diagnose: (last) => frameToText(last as GridSnapshot) },
        );
        await editor.capture("end");

        // Middle via Go to Line.
        const middleBlock = BLOCKS / 2;
        await editor.sendKey("Ctrl+G");
        await editor.waitForText((t) => t.includes("Type a line number"));
        await editor.sendText(String(middleBlock * 6 + 2));
        await editor.sendKey("Enter");
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => exportFg(frame, middleBlock) === keyword,
            { describe: "middle of the file is highlighted", diagnose: (last) => frameToText(last as GridSnapshot) },
        );
        await editor.capture("middle");

        const fgAt = (frame: GridSnapshot, needle: string): number | undefined => {
            const cell = findTextCell(frame, needle);
            return cell === null ? undefined : frame.cells[cell.y * frame.cols + cell.x].fg;
        };
        await editor.sendKey("ArrowUp");
        await editor.sendKey("Home");
        await editor.sendText("const answer = 42;");
        await editor.sendKey("Escape"); // completion popup, if it opened
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => {
                const typed = fgAt(frame, "const answer = 42;");
                return (
                    typed !== undefined && typed === fgAt(frame, "const text") && typed !== valueFg(frame, middleBlock)
                );
            },
            { describe: "typed text is highlighted", diagnose: (last) => frameToText(last as GridSnapshot) },
        );
        await editor.capture("typed");
    },
});
