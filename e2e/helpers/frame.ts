import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";


/** One frame row by index (untrimmed). */
export function frameLine(frame: GridSnapshot, y: number): string {
    let line = "";
    for (let x = 0; x < frame.cols; x++) line += frame.cells[y * frame.cols + x].char;
    return line;
}

/** Trailing whitespace is trimmed. */
export function frameToText(frame: GridSnapshot): string {
    const lines: string[] = [];
    for (let y = 0; y < frame.rows; y++) lines.push(frameLine(frame, y).replace(/\s+$/u, ""));
    return lines.join("\n");
}

export function dumpFrame(frame: GridSnapshot): string {
    const lines: string[] = [];
    for (let y = 0; y < frame.rows; y++) lines.push(`${String(y).padStart(2, " ")}|${frameLine(frame, y)}`);
    return lines.join("\n");
}

/** 0-based x/y of the substring start, or `null`. */
export function findTextCell(frame: GridSnapshot, needle: string): { x: number; y: number } | null {
    for (let y = 0; y < frame.rows; y++) {
        const x = frameLine(frame, y).indexOf(needle);
        if (x >= 0) return { x, y };
    }
    return null;
}
