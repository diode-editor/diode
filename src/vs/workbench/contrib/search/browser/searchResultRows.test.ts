import { describe, expect, it } from "vitest";

import { packRgb } from "../../../../../../tuidom/common/colorUtils.ts";
import { Point } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import type { ITextMatch } from "../../../services/search/common/textSearch.ts";

import { buildFileRow, buildMatchRow, formatFileRow, type ISearchRowStyles, trimBefore } from "./searchResultRows.ts";

const DIM = packRgb(128, 128, 128);
const MATCH_FG = packRgb(0, 0, 0);
const MATCH_BG = packRgb(234, 92, 0);
const STYLES: ISearchRowStyles = { dimFg: DIM, matchFg: MATCH_FG, matchBg: MATCH_BG };

function makeMatch(overrides: Partial<ITextMatch> & { preview?: ITextMatch["preview"] } = {}): ITextMatch {
    return {
        lineNumber: 12,
        startColumn: 6,
        endColumn: 12,
        preview: { before: "const ", inside: "needle", after: " = 42;" },
        ...overrides,
    };
}

describe("searchResultRows", () => {
    it("file row shows the path and a dimmed match count", () => {
        const row = buildFileRow("f", "src/main.ts", 3, STYLES);
        const backend = renderElement(row, 30, 1);

        expect(backend.getTextAt(new Point(0, 0), 14)).toBe("src/main.ts  3");
        expect(backend.getFgAt(new Point(13, 0))).toBe(DIM);
        expect(backend.getFgAt(new Point(0, 0))).not.toBe(DIM);
    });

    it("formatFileRow updates the count in place as results stream in", () => {
        const row = buildFileRow("f", "a.ts", 1, STYLES);
        formatFileRow(row, "a.ts", 25, STYLES);
        const backend = renderElement(row, 20, 1);

        expect(backend.getTextAt(new Point(0, 0), 8)).toBe("a.ts  25");
        expect(backend.getFgAt(new Point(6, 0))).toBe(DIM);
        expect(backend.getFgAt(new Point(7, 0))).toBe(DIM);
    });

    it("match row shows a dimmed line number and highlights the matched span", () => {
        const row = buildMatchRow("m", makeMatch(), STYLES);
        const backend = renderElement(row, 40, 1);

        expect(backend.getTextAt(new Point(0, 0), 22)).toBe("12  const needle = 42;");
        expect(backend.getFgAt(new Point(0, 0))).toBe(DIM);
        expect(backend.getFgAt(new Point(1, 0))).toBe(DIM);
        // "needle" начинается после "12  const " = колонка 10.
        for (let x = 10; x < 16; x++) {
            expect(backend.getFgAt(new Point(x, 0))).toBe(MATCH_FG);
            expect(backend.getBgAt(new Point(x, 0))).toBe(MATCH_BG);
        }
        expect(backend.getBgAt(new Point(16, 0))).not.toBe(MATCH_BG);
    });

    it("long context before the match is trimmed with a leading ellipsis", () => {
        const longBefore = "x".repeat(80) + "tail ";
        const row = buildMatchRow(
            "m",
            makeMatch({ preview: { before: longBefore, inside: "hit", after: "" } }),
            STYLES,
        );
        const backend = renderElement(row, 40, 1);

        expect(backend.getTextAt(new Point(4, 0), 1)).toBe("…");
        // Матч виден и подсвечен, несмотря на длинный контекст.
        const text = backend.getTextAt(new Point(0, 0), 40);
        const hitStart = text.indexOf("hit");
        expect(hitStart).toBeGreaterThan(0);
        expect(backend.getBgAt(new Point(hitStart, 0))).toBe(MATCH_BG);
    });

    it("trimBefore keeps short strings untouched", () => {
        expect(trimBefore("short")).toBe("short");
        expect(trimBefore("")).toBe("");
        const trimmed = trimBefore("a".repeat(100));
        expect(trimmed.length).toBe(24);
        expect(trimmed.startsWith("…")).toBe(true);
    });
});
