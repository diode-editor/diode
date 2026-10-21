import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { buildRgArgs, parseRgMatchLine } from "../../../services/search/common/textSearch.ts";

import { buildMatchRow, type ISearchRowStyles } from "./searchResultRows.ts";

// Regression of search view slowness: without the tail cap in splitPreviewByBytes, one match in a minified/lock file
// put a line of hundreds of kilobytes into TextLabelElement, which rendering re-segmented on every frame.

const STYLES: ISearchRowStyles = {
    dimFg: packRgb(128, 128, 128),
    matchFg: packRgb(0, 0, 0),
    matchBg: packRgb(234, 92, 0),
};

/** Builds the match through the real rg --json parser — that's where the cap lives. */
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

describe("searchResultRows — long lines are capped at the source", () => {
    it("the row for a match in a 100k-character line stays short", () => {
        const match = parseMatch("const needle = " + "x".repeat(100_000) + "\n", 6, 12);

        const row = buildMatchRow("m", match, STYLES);

        // lineNumber + GAP + before(≤24) + inside + after(≤256).
        expect(row.getText().length).toBeLessThan(300);
    });

    it("ripgrep arguments deliberately omit --max-columns", () => {
        // The cap lives in splitPreviewByBytes: --max-columns would change the byte
        // offsets of submatches and drop long lines from the results entirely.
        const args = buildRgArgs(
            {
                pattern: "needle",
                isRegExp: false,
                isCaseSensitive: false,
                isWholeWord: false,
                includes: [],
                excludes: [],
                useIgnoreFiles: { local: true, parent: false, global: false },
            },
            "/repo",
        );

        expect(args).not.toBeNull();
        expect(args).not.toContain("--max-columns");
    });
});
