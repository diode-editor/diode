import { describe, expect, it } from "vitest";

import { detectIndentation, type IIndentationDefaults } from "./indentationDetector.ts";
import { TextDocument } from "./textDocument.ts";

function makeDoc(lines: string[]): TextDocument {
    return new TextDocument(lines.join("\n"));
}

const SPACES_4: IIndentationDefaults = { tabSize: 4, insertSpaces: true };

describe("detectIndentation", () => {
    it("detects 2 spaces in a package.json-shaped file", () => {
        // Regression: the most frequent width here is 4, but the step is 2.
        const doc = makeDoc([
            "{",
            '  "name": "diode",',
            '  "scripts": {',
            '    "build": "tsup",',
            '    "test": "vitest run"',
            "  },",
            '  "engines": {',
            '    "node": ">=24.0.0"',
            "  }",
            "}",
        ]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 2 });
    });

    it("is not thrown off by the single-space continuation of a block comment", () => {
        // Regression: ` * …` gives width 1, and counting by absolute widths (GCD) would zero out the file.
        const doc = makeDoc([
            "/**",
            " * Does things.",
            " */",
            "function foo() {",
            "    if (x) {",
            "        return 1;",
            "    }",
            "}",
        ]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
    });

    it("detects tabs and leaves the tab width to the defaults", () => {
        const doc = makeDoc(["function foo() {", "\tif (x) {", "\t\treturn 1;", "\t}", "}"]);

        expect(detectIndentation(doc, { tabSize: 8, insertSpaces: true })).toEqual({
            insertSpaces: false,
            tabSize: 8,
        });
    });

    it("falls back to the defaults for a file without indentation", () => {
        const doc = makeDoc(["hello", "world"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
        expect(detectIndentation(doc, { tabSize: 2, insertSpaces: false })).toEqual({
            insertSpaces: false,
            tabSize: 2,
        });
    });

    it("falls back to the defaults for an empty document", () => {
        expect(detectIndentation(makeDoc([]), SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
    });

    it("detects 8-space indentation — the limit candidate", () => {
        const doc = makeDoc(["a() {", "        b;", "        c;", "}"]);

        expect(detectIndentation(doc, { tabSize: 2, insertSpaces: true })).toEqual({
            insertSpaces: true,
            tabSize: 8,
        });
    });

    it("space indentation overrides defaults.insertSpaces=false", () => {
        const doc = makeDoc(["function foo() {", "  const x = 1;", "}"]);

        expect(detectIndentation(doc, { tabSize: 4, insertSpaces: false })).toEqual({
            insertSpaces: true,
            tabSize: 2,
        });
    });

    it("with tab indentation the width comes from defaults, not from the file's whitespace-only lines", () => {
        const doc = makeDoc(["\ta", "\tb", "\tc", "  x", "    y"]);

        expect(detectIndentation(doc, { tabSize: 8, insertSpaces: true })).toEqual({
            insertSpaces: false,
            tabSize: 8,
        });
    });

    it("falls back to defaults.insertSpaces when tabs and spaces tie", () => {
        const doc = makeDoc(["\ttab;", "  spaces;"]);

        expect(detectIndentation(doc, SPACES_4).insertSpaces).toBe(true);
        expect(detectIndentation(doc, { tabSize: 4, insertSpaces: false }).insertSpaces).toBe(false);
    });

    it("compares indentation across blank lines", () => {
        const doc = makeDoc(["function f() {", "", "    a;", "", "    b;", "", "}"]);

        expect(detectIndentation(doc, { tabSize: 2, insertSpaces: true })).toEqual({
            insertSpaces: true,
            tabSize: 4,
        });
    });

    it("ignores whitespace-only lines", () => {
        const doc = makeDoc(["function f() {", "    a;", "        ", "    b;", "}"]);

        expect(detectIndentation(doc, { tabSize: 2, insertSpaces: true })).toEqual({
            insertSpaces: true,
            tabSize: 4,
        });
    });

    it("a whitespace-only line's width does not enter the step histogram", () => {
        // If whitespace-only lines counted as content, step 4 would drown out the real 2.
        const doc = makeDoc(["a", "  b", "      ", "  c", "      ", "  d"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 2 });
    });

    it("a whitespace-only line does not count as indented by one character", () => {
        // If a whitespace-only line had "indent 1", the steps would shift to 3.
        const doc = makeDoc(["a", "    b", "    ", "    c", "    ", "    d", "    ", "    e"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
    });

    it("a whitespace-only line does not vote in the tabs vs spaces contest", () => {
        const doc = makeDoc(["\ta", "  b", "      "]);

        expect(detectIndentation(doc, { tabSize: 4, insertSpaces: false }).insertSpaces).toBe(false);
    });

    it("lines with a single leading space do not make the file space-indented", () => {
        const doc = makeDoc(["/**", " * a", " */"]);

        expect(detectIndentation(doc, { tabSize: 4, insertSpaces: false }).insertSpaces).toBe(false);
    });

    it("ignores a step wider than the largest guess", () => {
        const doc = makeDoc(["a", "          b"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
    });

    it("lets 2 win over 4 when it is at least half as frequent", () => {
        const doc = makeDoc(["a", "    b", "a", "    b", "  c", "    d"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 2 });
    });

    it("exactly half the frequency of four — two still wins", () => {
        // Steps: 4 × 4, 2 × 2 — the boundary of the "at least half as often" rule.
        const doc = makeDoc(["a", "    b", "a", "    b", "a", "  c", "a"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 2 });
    });

    it("the two-instead-of-four rule leaves a winning six alone", () => {
        // Steps: 6 × 5, 2 × 3, 4 × 1 — 6 wins, and switching to 2 would be wrong.
        const doc = makeDoc(["a", "      b", "a", "      b", "a", "      b", "    c", "a", "  d", "a"]);

        expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 6 });
    });

    describe("mixed tabs and spaces", () => {
        it("ignores a step where either side mixes tabs and spaces", () => {
            const doc = makeDoc(["  \ta", "x"]);

            expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: false, tabSize: 4 });
        });

        it("reads the tab width off a tabs → spaces step when it divides evenly", () => {
            const doc = makeDoc(["\t\tx", "    y", "    z"]);

            expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 2 });
        });

        it("ignores a tabs → spaces step that does not divide evenly", () => {
            const doc = makeDoc(["\t\tx", "   y", "   z", "   w"]);

            expect(detectIndentation(doc, { tabSize: 3, insertSpaces: true })).toEqual({
                insertSpaces: true,
                tabSize: 3,
            });
        });
    });

    describe("continuation lines", () => {
        it("ignores a line aligned under the arguments of the previous one", () => {
            // Without this heuristic step 7 would be the only candidate and win.
            const doc = makeDoc(["foo(a, b,", "       c);"]);

            expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 4 });
        });

        it("counts the same shape when the previous line does not end in a comma", () => {
            const doc = makeDoc(["foo(a, b;", "       c);"]);

            expect(detectIndentation(doc, SPACES_4)).toEqual({ insertSpaces: true, tabSize: 7 });
        });
    });
});
