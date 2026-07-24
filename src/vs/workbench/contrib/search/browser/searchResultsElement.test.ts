import { describe, expect, it } from "vitest";

import { Point } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { SearchResultsElement, type ISearchResultsStyles, type SearchRow } from "./searchResultsElement.ts";

const STYLES: ISearchResultsStyles = { fg: 1, bg: 2, dimFg: 3, matchFg: 4, matchBg: 5 };

function make(rows: SearchRow[]): SearchResultsElement {
    const el = new SearchResultsElement();
    el.setStyles(STYLES);
    el.setRows(rows);
    return el;
}

describe("SearchResultsElement", () => {
    it("renders a file header with its match count", () => {
        const el = make([{ kind: "file", label: "src/a.ts", count: 3 }]);
        const screen = renderElement(el, 30, 4).screenToString();
        expect(screen).toContain("src/a.ts");
        expect(screen).toContain("3");
    });

    it("renders a match row: line number, and before/inside/after text", () => {
        const el = make([{ kind: "match", lineNumber: 12, before: "const ", inside: "foo", after: " = 1" }]);
        const backend = renderElement(el, 40, 2);
        const screen = backend.screenToString();
        expect(screen).toContain("12");
        expect(screen).toContain("const foo = 1");
    });

    it("paints the matched span with the highlight background", () => {
        const el = make([
            { kind: "file", label: "a.ts", count: 1 },
            { kind: "match", lineNumber: 12, before: "const ", inside: "foo", after: " = 1" },
        ]);
        const backend = renderElement(el, 40, 3);
        // Match row is y=1; inside starts after indent(2) + "12"(2) + gap(2) + "const "(6) = col 12.
        expect(backend.getBgAt(new Point(12, 1))).toBe(STYLES.matchBg);
        // A column in `before` keeps the default background.
        expect(backend.getBgAt(new Point(6, 1))).toBe(STYLES.bg);
    });

    it("fills rows beyond the results with the background", () => {
        const el = make([{ kind: "file", label: "a.ts", count: 1 }]);
        // Viewport taller than the single row — extra lines are blank.
        const backend = renderElement(el, 20, 5);
        expect(backend.getBgAt(new Point(0, 4))).toBe(STYLES.bg);
    });

    it("reports content height equal to the number of rows", () => {
        const el = make([
            { kind: "file", label: "a.ts", count: 1 },
            { kind: "match", lineNumber: 1, before: "", inside: "foo", after: "" },
        ]);
        expect(el.contentHeight).toBe(2);
    });
});
