import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { buildRgArgs, parseRgMatchLine } from "../../../services/search/common/textSearch.ts";

import { buildMatchRow, type ISearchRowStyles } from "./searchResultRows.ts";

// Регресс-тесты диагностики тормозов окна поиска (docs/TODO/SearchPerformance.md,
// случай 1): хвост совпавшей строки капается у истока — в splitPreviewByBytes при
// разборе rg --json. Без капа один матч в минифицированном/lock-файле клал в
// TextLabelElement строку на сотни килобайт, которую рендер пересегментировал
// на каждом кадре.

const STYLES: ISearchRowStyles = {
    dimFg: packRgb(128, 128, 128),
    matchFg: packRgb(0, 0, 0),
    matchBg: packRgb(234, 92, 0),
};

/** Строит матч через настоящий парсер rg --json — кап живёт именно там. */
function parseMatch(lineText: string, start: number, end: number) {
    const line = JSON.stringify({
        type: "match",
        data: {
            path: { text: "/a.min.js" },
            lines: { text: lineText },
            line_number: 1,
            absolute_offset: 0,
            submatches: [{ match: { text: lineText.slice(start, end) }, start, end }],
        },
    });
    return parseRgMatchLine(line)!.matches[0];
}

describe("searchResultRows — длинные строки ограничены у истока", () => {
    it("ряд для матча в 100k-символьной строке остаётся коротким", () => {
        const match = parseMatch("const needle = " + "x".repeat(100_000) + "\n", 6, 12);

        const row = buildMatchRow("m", match, STYLES);

        // lineNumber + GAP + before(≤24) + inside + after(≤256).
        expect(row.getText().length).toBeLessThan(300);
    });

    it("аргументы ripgrep не содержат --max-columns — осознанно", () => {
        // Кап живёт в splitPreviewByBytes: --max-columns менял бы байтовые
        // офсеты сабматчей и выкидывал длинные строки из результатов целиком.
        const args = buildRgArgs(
            {
                pattern: "needle",
                isRegExp: false,
                isCaseSensitive: false,
                isWholeWord: false,
                includes: [],
                excludes: [],
            },
            "/repo",
        );

        expect(args).not.toBeNull();
        expect(args).not.toContain("--max-columns");
    });
});
