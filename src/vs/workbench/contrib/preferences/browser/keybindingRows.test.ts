import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import type { FuzzyMatch } from "../../../../base/common/fuzzySearch.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IFilteredKeybindingItem, IKeybindingItem } from "../common/keybindingsEditorModel.ts";

import type { IKeybindingRowStyles } from "./keybindingRows.ts";
import {
    buildKeybindingHeaderRow,
    buildKeybindingRow,
    describeKeybindingHeaderRow,
    describeKeybindingRow,
} from "./keybindingRows.ts";

const STYLES: IKeybindingRowStyles = {
    dimFg: "descriptionForeground",
    highlightFg: "list.highlightForeground",
    conflictFg: "editorWarning.foreground",
};

function match(indices: number[]): FuzzyMatch {
    return { score: 0, matchedIndices: indices };
}

function item(overrides: Partial<IKeybindingItem> = {}): IKeybindingItem {
    return {
        commandId: "save",
        title: "Save File",
        chord: parseChord("ctrl+s"),
        when: undefined,
        source: "default",
        hasConflict: false,
        ...overrides,
    };
}

function filtered(
    overrides: Partial<IKeybindingItem> = {},
    titleMatch: IFilteredKeybindingItem["titleMatch"] = null,
): IFilteredKeybindingItem {
    return { item: item(overrides), titleMatch };
}

const WIDTH = 80;

describe("describeKeybindingRow", () => {
    it("columns sit at the same positions in all rows", () => {
        const a = describeKeybindingRow(filtered({ title: "Short" }), WIDTH);
        const b = describeKeybindingRow(filtered({ title: "A much longer command title here" }), WIDTH);

        expect(a.keySpan.start).toBe(b.keySpan.start);
        expect(a.whenSpan.start).toBe(b.whenSpan.start);
        expect(a.sourceSpan.start).toBe(b.sourceSpan.start);
    });

    it("on mac the Keybinding column uses glyphs", () => {
        const layout = describeKeybindingRow(filtered({ chord: parseChord("shift+meta+p") }), WIDTH, "mac");
        const keyText = layout.text.slice(layout.keySpan.start, layout.keySpan.start + layout.keySpan.length);
        expect(keyText.trimEnd()).toBe("⇧⌘P");
    });

    it("column contents are read by spans", () => {
        const layout = describeKeybindingRow(
            filtered({ title: "Save File", when: "textViewFocus", source: "extension" }),
            WIDTH,
        );

        expect(layout.text.startsWith("Save File")).toBe(true);
        expect(layout.text.slice(layout.keySpan.start, layout.keySpan.start + layout.keySpan.length).trimEnd()).toBe(
            "Ctrl+S",
        );
        expect(layout.text.slice(layout.whenSpan.start, layout.whenSpan.start + layout.whenSpan.length).trimEnd()).toBe(
            "textViewFocus",
        );
        expect(
            layout.text.slice(layout.sourceSpan.start, layout.sourceSpan.start + layout.sourceSpan.length).trimEnd(),
        ).toBe("Extension");
    });

    it("a row without a keybinding shows a dash and an empty source", () => {
        const layout = describeKeybindingRow(filtered({ chord: null, source: null }), WIDTH);

        expect(layout.text.slice(layout.keySpan.start, layout.keySpan.start + layout.keySpan.length).trimEnd()).toBe(
            "—",
        );
        expect(
            layout.text.slice(layout.sourceSpan.start, layout.sourceSpan.start + layout.sourceSpan.length).trimEnd(),
        ).toBe("");
    });

    it("a long title is truncated with an ellipsis without shifting columns", () => {
        const title = "X".repeat(200);
        const layout = describeKeybindingRow(filtered({ title }), WIDTH);
        const short = describeKeybindingRow(filtered(), WIDTH);

        expect(layout.text).toContain("…");
        expect(layout.keySpan.start).toBe(short.keySpan.start);
    });

    it("highlights do not spill onto the ellipsis: indices past the cut are dropped", () => {
        const title = "Y".repeat(200);
        const match = { score: 0, matchedIndices: [0, 1, 150] };
        const layout = describeKeybindingRow(filtered({ title }, match), WIDTH);

        expect(layout.matchIndices).toEqual([0, 1]);
    });

    it("a narrow tab does not break the layout: width is clamped to the table minimum", () => {
        const layout = describeKeybindingRow(filtered(), 10);

        expect(layout.keySpan.length).toBeGreaterThan(0);
        expect(layout.sourceSpan.length).toBeGreaterThan(0);
    });
});

describe("conflict", () => {
    it("is passed into the layout and colors the Keybinding column on build", () => {
        const layout = describeKeybindingRow(filtered({ hasConflict: true }), WIDTH);
        expect(layout.conflict).toBe(true);

        // Building with a conflict doesn't throw and carries the same text (color is in char styles).
        const row = buildKeybindingRow("kb-0", layout, {
            dimFg: "descriptionForeground",
            highlightFg: "list.highlightForeground",
            conflictFg: "editorWarning.foreground",
        });
        expect(row.getText()).toBe(layout.text);
    });

    it("a conflict-free row carries no flag", () => {
        expect(describeKeybindingRow(filtered(), WIDTH).conflict).toBe(false);
    });
});

describe("table header", () => {
    it("header columns match row columns", () => {
        const header = describeKeybindingHeaderRow(WIDTH);
        const row = describeKeybindingRow(filtered(), WIDTH);

        expect(header.startsWith("Command")).toBe(true);
        expect(header.slice(row.keySpan.start)).toMatch(/^Keybinding/);
        expect(header.slice(row.whenSpan.start)).toMatch(/^When/);
        expect(header.slice(row.sourceSpan.start)).toMatch(/^Source/);
    });

    it("buildKeybindingHeaderRow yields a row with the id and header text", () => {
        const row = buildKeybindingHeaderRow("kbHeader", WIDTH, "descriptionForeground");

        expect(row.id).toBe("kbHeader");
        expect(row.getText()).toBe(describeKeybindingHeaderRow(WIDTH));
    });
});

describe("describeKeybindingRow — When column and highlights", () => {
    it("an empty when gives an empty column (not a literal placeholder)", () => {
        const layout = describeKeybindingRow(filtered({ when: undefined }), WIDTH);
        expect(layout.text.slice(layout.whenSpan.start, layout.whenSpan.start + layout.whenSpan.length).trim()).toBe(
            "",
        );
    });

    it("a highlight on the last char of a NON-truncated title is kept (keptLength = title length)", () => {
        // A short title fits entirely: the index of the last character must pass the filter.
        const layout = describeKeybindingRow(filtered({ title: "Ab" }, match([1])), WIDTH);
        expect(layout.matchIndices).toEqual([1]);
    });

    it("on a truncated title the index at the keptLength boundary is dropped (strict <)", () => {
        // A long title is truncated; keptLength = visible prefix length − 1 (room for "…").
        const title = "C".repeat(60);
        const layout = describeKeybindingRow(filtered({ title }, match([0, 1, 200])), WIDTH);
        const kept = title.length; // exact value doesn't matter — what matters is that boundary/out-of-bounds indices are dropped
        expect(layout.matchIndices).toEqual([0, 1]);
        expect(layout.matchIndices.every((i) => i < kept)).toBe(true);
        // Indices at keptLength and beyond are dropped — take the index at the very tail of the visible part.
        const boundary = describeKeybindingRow(filtered({ title }, match([0, layout.text.indexOf("…")])), WIDTH);
        expect(boundary.matchIndices).toEqual([0]);
    });
});

describe("buildKeybindingRow — column coloring", () => {
    function fgAt(row: ReturnType<typeof buildKeybindingRow>, col: number): number {
        return renderElement(row, WIDTH, 1, { themeVars: true }).getFgAt(new Point(col, 0));
    }

    it("carries the id and the full layout text", () => {
        const layout = describeKeybindingRow(filtered({ when: "listFocus" }), WIDTH);
        const row = buildKeybindingRow("kb-0", layout, STYLES);
        expect(row.id).toBe("kb-0");
        expect(row.getText()).toBe(layout.text);
    });

    it("When and Source are dimmed — their color differs from the command's", () => {
        const layout = describeKeybindingRow(filtered({ when: "listFocus", source: "extension" }), WIDTH);
        const row = buildKeybindingRow("kb-0", layout, STYLES);
        const commandFg = fgAt(row, 0);

        expect(fgAt(row, layout.whenSpan.start)).not.toBe(commandFg);
        expect(fgAt(row, layout.sourceSpan.start)).not.toBe(commandFg);
        // Right past the When column (the separator char) dimming does NOT leak — the span boundary is exact.
        expect(fgAt(row, layout.whenSpan.start + layout.whenSpan.length)).toBe(commandFg);
    });

    it("a conflict colors the Keybinding column, a plain row does not", () => {
        const conflictRow = buildKeybindingRow(
            "kb-c",
            describeKeybindingRow(filtered({ hasConflict: true }), WIDTH),
            STYLES,
        );
        const plainRow = buildKeybindingRow(
            "kb-p",
            describeKeybindingRow(filtered({ hasConflict: false }), WIDTH),
            STYLES,
        );
        const key = describeKeybindingRow(filtered(), WIDTH).keySpan.start;

        expect(fgAt(conflictRow, key)).not.toBe(fgAt(plainRow, key));
    });

    it("a matched title char is highlighted — its color differs from an unmatched one", () => {
        const highlighted = buildKeybindingRow("kb-h", describeKeybindingRow(filtered({}, match([0])), WIDTH), STYLES);
        const plain = buildKeybindingRow("kb-n", describeKeybindingRow(filtered({}, null), WIDTH), STYLES);

        expect(fgAt(highlighted, 0)).not.toBe(fgAt(plain, 0));
    });

    it("the header is dimmed — its color differs from a plain row's command", () => {
        const header = buildKeybindingHeaderRow("kbHeader", WIDTH, "descriptionForeground");
        const row = buildKeybindingRow("kb-0", describeKeybindingRow(filtered(), WIDTH), STYLES);

        expect(fgAt(header, 0)).not.toBe(fgAt(row, 0));
    });
});
