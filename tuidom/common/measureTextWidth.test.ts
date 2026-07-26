import { describe, expect, it } from "vitest";

import { DisplayLine } from "./displayLine.ts";
import { measureTextWidth } from "./measureTextWidth.ts";

/**
 * The width cache relies on `measureTextWidth` being a byte-for-byte substitute
 * for `DisplayLine.displayWidth`. These cases lock that parity across every
 * tricky category (tabs, CJK, emoji ZWJ sequences, VS16, combining marks).
 */
const PARITY_CASES: Array<[string, string]> = [
    ["empty", ""],
    ["ascii", "const x = 42;"],
    ["spaces", "a b  c   d"],
    ["single tab", "\tx"],
    ["tabs mid-line", "a\tb\tc"],
    ["carriage return", "abc\r"],
    ["cjk", "日本語のテキスト"],
    ["mixed ascii + cjk", "id: 名前 = value"],
    ["emoji presentation", "hi 😀 there ⭐"],
    ["emoji ZWJ family", "👨‍👩‍👧 family"],
    ["vs16 heart", "love ❤️ it"],
    ["combining marks", "é́ café"],
];

describe("measureTextWidth — parity with DisplayLine.displayWidth", () => {
    for (const [name, text] of PARITY_CASES) {
        it(`matches for: ${name}`, () => {
            for (const tabSize of [2, 4, 8]) {
                expect(measureTextWidth(text, tabSize)).toBe(new DisplayLine(text, tabSize).displayWidth);
            }
        });
    }

    it("matches on a long mixed line", () => {
        const text = "x\t日😀".repeat(2_000);
        expect(measureTextWidth(text)).toBe(new DisplayLine(text).displayWidth);
    });
});

describe("measureTextWidth — stopAfter cap", () => {
    it("defaults to no cap", () => {
        expect(measureTextWidth("a".repeat(5_000))).toBe(5_000);
    });

    it("caps the scan and matches a capped DisplayLine", () => {
        const text = "a".repeat(1_000);
        expect(measureTextWidth(text, 4, 100)).toBe(100);
        expect(measureTextWidth(text, 4, 100)).toBe(new DisplayLine(text, 4, 100).displayWidth);
    });

    it("bounds cost on an extreme line (result equals the cap, not the length)", () => {
        expect(measureTextWidth("z".repeat(1_000_000), 4, 10_000)).toBe(10_000);
    });

    it("stops on a grapheme boundary, matching DisplayLine", () => {
        const text = "😀".repeat(50); // 100 code units
        // cap 5 → only clusters starting at index < 5 kept: index 0 and 2 and 4 → 3 clusters → 6 cols
        expect(measureTextWidth(text, 4, 5)).toBe(new DisplayLine(text, 4, 5).displayWidth);
    });
});
