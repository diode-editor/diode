import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell, frameToText } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";
import { defineScenario } from "./framework.ts";


const BLOCKS = 10_000; // 6 строк на блок — 60k строк
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

/** Цвет `export` в строке `export function f<n>` — keyword, если строка покрашена. */
function exportFg(frame: GridSnapshot, block: number): number | undefined {
    const cell = findTextCell(frame, `export function f${String(block)}(`);
    return cell === null ? undefined : frame.cells[cell.y * frame.cols + cell.x].fg;
}

/** Цвет `value` (параметр — не keyword) в той же строке. */
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
        // Верх файла: keyword красится не цветом идентификатора.
        const top = await waitUntil(
            () => editor.captureFrame(),
            (frame) => exportFg(frame, 0) !== undefined && exportFg(frame, 0) !== valueFg(frame, 0),
            { describe: "верх файла покрашен", diagnose: (last) => frameToText(last as GridSnapshot) },
        );
        const keyword = exportFg(top, 0);
        await editor.capture("top");

        // Конец файла — сразу keyword-цветом, хотя фон до него ещё не дошёл.
        await editor.sendKey("Ctrl+End");
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => exportFg(frame, BLOCKS - 1) === keyword,
            { describe: "конец файла покрашен", diagnose: (last) => frameToText(last as GridSnapshot) },
        );
        await editor.capture("end");

        // Середина — Go to Line.
        const middleBlock = BLOCKS / 2;
        await editor.sendKey("Ctrl+G");
        await editor.waitForText((t) => t.includes("Type a line number"));
        await editor.sendText(String(middleBlock * 6 + 2));
        await editor.sendKey("Enter");
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => exportFg(frame, middleBlock) === keyword,
            { describe: "середина файла покрашена", diagnose: (last) => frameToText(last as GridSnapshot) },
        );
        await editor.capture("middle");

        const fgAt = (frame: GridSnapshot, needle: string): number | undefined => {
            const cell = findTextCell(frame, needle);
            return cell === null ? undefined : frame.cells[cell.y * frame.cols + cell.x].fg;
        };
        await editor.sendKey("ArrowUp");
        await editor.sendKey("Home");
        await editor.sendText("const answer = 42;");
        await editor.sendKey("Escape"); // попап автодополнения, если открылся
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => {
                const typed = fgAt(frame, "const answer = 42;");
                return typed !== undefined && typed === fgAt(frame, "const text") && typed !== valueFg(frame, middleBlock);
            },
            { describe: "набранное покрашено", diagnose: (last) => frameToText(last as GridSnapshot) },
        );
        await editor.capture("typed");
    },
});
