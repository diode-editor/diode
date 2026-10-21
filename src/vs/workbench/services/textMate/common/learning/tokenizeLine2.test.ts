import vsctm from "vscode-textmate";
const { INITIAL } = vsctm;
import { describe, expect, it } from "vitest";

import { createTestRegistry } from "./testRegistry.ts";

/**
 * Learning tests for the binary `tokenizeLine2` API.
 *
 * `tokenizeLine2` returns a flat `Uint32Array` of `(startIndex, metadata)` pairs:
 *
 * ```
 *   [start_0, meta_0, start_1, meta_1, ..., start_N, meta_N]
 * ```
 *
 * `metadata` is packed as:
 *
 * ```
 *   bits 0..7   : language id
 *   bits 8..9   : standard token type
 *   bit  10     : balanced brackets flag
 *   bits 11..14 : font style (bitmask: italic=1, bold=2, underline=4, strikethrough=8)
 *   bits 15..23 : foreground color id (index into registry.getColorMap())
 *   bits 24..31 : background color id
 * ```
 *
 * Adjacent tokens with the same metadata merge into one, so
 * without a theme (when all metadata is the same) the whole line is a single token.
 */

const FONT_STYLE_OFFSET = 11;
const FOREGROUND_OFFSET = 15;
const BACKGROUND_OFFSET = 24;

const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;

function fontStyle(metadata: number): number {
    return (metadata >>> FONT_STYLE_OFFSET) & 0b1111;
}
function foregroundId(metadata: number): number {
    return (metadata >>> FOREGROUND_OFFSET) & 0x1ff;
}
function backgroundId(metadata: number): number {
    return (metadata >>> BACKGROUND_OFFSET) & 0xff;
}

describe("vscode-textmate :: tokenizeLine2 (binary)", () => {
    it("без темы все токены имеют одинаковую metadata и схлопываются в один", async () => {
        const reg = createTestRegistry();
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const result = g.tokenizeLine2("const x = 1;", INITIAL);

        // exactly one (start, meta) pair
        expect(result.tokens.length).toBe(2);
        expect(result.tokens[0]).toBe(0);
    });

    it("с темой metadata кодирует foreground id и font style", async () => {
        const reg = createTestRegistry();
        reg.setTheme({
            settings: [
                { settings: { foreground: "#000000", background: "#ffffff" } },
                { scope: "storage.type", settings: { foreground: "#0000ff", fontStyle: "bold" } },
                { scope: "constant.numeric", settings: { foreground: "#ff0000" } },
                { scope: "comment", settings: { foreground: "#888888", fontStyle: "italic" } },
            ],
        });
        const g = await reg.loadGrammar("source.js");
        if (!g) throw new Error("grammar not loaded");

        const line = "const x = 1; // hi";
        const result = g.tokenizeLine2(line, INITIAL);
        const colorMap = reg.getColorMap();

        // The `const` token (startIndex === 0)
        const constMeta = result.tokens[1];
        expect(fontStyle(constMeta) & FONT_STYLE_BOLD).toBe(FONT_STYLE_BOLD);
        expect(colorMap[foregroundId(constMeta)].toLowerCase()).toBe("#0000ff");

        // The last pair is the `// hi` comment
        const lastMeta = result.tokens[result.tokens.length - 1];
        expect(fontStyle(lastMeta) & FONT_STYLE_ITALIC).toBe(FONT_STYLE_ITALIC);
        expect(colorMap[foregroundId(lastMeta)].toLowerCase()).toBe("#888888");

        // Background is shared, independent of scope
        expect(colorMap[backgroundId(constMeta)].toLowerCase()).toBe("#ffffff");
    });

    it("getColorMap() возвращает массив hex-строк, индексируемый foreground/background id", () => {
        const reg = createTestRegistry();
        reg.setTheme({ settings: [{ settings: { foreground: "#112233", background: "#445566" } }] });
        const colorMap = reg.getColorMap();

        // Index 0 is reserved (empty), colors start at 1.
        expect(colorMap[1].toLowerCase()).toBe("#112233");
        expect(colorMap[2].toLowerCase()).toBe("#445566");
    });
});
