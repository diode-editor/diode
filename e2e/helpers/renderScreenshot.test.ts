import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { SPINNER_FRAMES } from "../../src/vs/platform/progress/common/progressService.ts";
import { BUNDLED_FONT_FILES, renderSnapshotToPng } from "./renderScreenshot.ts";

// A gate against "tofu": string assertions in unit tests see a spinner frame as a character, but
// in the image it may come out as an empty box. Exactly that happened in #272, when Hack
// (which lacks the U+2800 block) was the only vendored font.

/** Code points covered by the font: minimal `cmap` parsing (formats 4 and 12). */
function fontCodePoints(path: string): Set<number> {
    const buf = readFileSync(path);
    const numTables = buf.readUInt16BE(4);
    let cmap = -1;
    for (let i = 0; i < numTables; i++) {
        const record = 12 + i * 16;
        if (buf.toString("ascii", record, record + 4) === "cmap") cmap = buf.readUInt32BE(record + 8);
    }
    if (cmap < 0) throw new Error(`${basename(path)}: нет таблицы cmap`);

    const covered = new Set<number>();
    const subtables = buf.readUInt16BE(cmap + 2);
    for (let i = 0; i < subtables; i++) {
        const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
        const format = buf.readUInt16BE(sub);
        if (format === 4) {
            const segX2 = buf.readUInt16BE(sub + 6);
            const ends = sub + 14;
            const starts = ends + segX2 + 2;
            for (let seg = 0; seg < segX2 / 2; seg++) {
                const end = buf.readUInt16BE(ends + seg * 2);
                const start = buf.readUInt16BE(starts + seg * 2);
                // The terminating 0xFFFF–0xFFFF segment is mandatory per the spec and empty.
                if (start === 0xffff) continue;
                for (let cp = start; cp <= end; cp++) covered.add(cp);
            }
        } else if (format === 12) {
            const groups = buf.readUInt32BE(sub + 12);
            for (let g = 0; g < groups; g++) {
                const record = sub + 16 + g * 12;
                const end = buf.readUInt32BE(record + 4);
                for (let cp = buf.readUInt32BE(record); cp <= end; cp++) covered.add(cp);
            }
        }
    }
    return covered;
}

/** A single-row line: default colors, cell width 1, as the real grid returns it. */
function snapshotOf(text: string): GridSnapshot {
    return {
        cols: [...text].length,
        rows: 1,
        cursor: null,
        cells: [...text].map((char) => ({ char, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, style: 0, width: 1 })),
    };
}

describe("растеризатор скриншотов", () => {
    it("завендоренные шрифты покрывают все кадры спиннера", () => {
        const covered = BUNDLED_FONT_FILES.map(fontCodePoints);
        const missing = SPINNER_FRAMES.filter((frame) => !covered.some((set) => set.has(frame.codePointAt(0)!)));
        expect(missing).toEqual([]);
    });

    it("разные кадры спиннера рисуются разными глифами", () => {
        // Without a covering font in the set, resvg draws the same `.notdef` for all
        // uncovered code points, so the PNG bytes match. Comparing against a space
        // catches the opposite case: the font is there but the glyph is empty.
        const [first, second] = SPINNER_FRAMES;
        const blank = renderSnapshotToPng(snapshotOf(" "));

        expect(renderSnapshotToPng(snapshotOf(first))).not.toEqual(renderSnapshotToPng(snapshotOf(second)));
        expect(renderSnapshotToPng(snapshotOf(first))).not.toEqual(blank);
    });
});
