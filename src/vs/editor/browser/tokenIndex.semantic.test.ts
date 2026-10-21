import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { describe, expect, it } from "vitest";

import { Event } from "../../base/common/event.ts";
import type { ISemanticTokensLegend } from "../common/languages/iSemanticTokensSource.ts";
import type { ISemanticTokenStyleResolver } from "../common/languages/iSemanticTokenStyleResolver.ts";

import { applySemanticStyle, resolveSemanticTokenStyle, SemanticTokenIndex } from "./tokenIndex.ts";

const LEGEND: ISemanticTokensLegend = { tokenTypes: ["a", "b", ""], tokenModifiers: ["m0", "m1", "m2"] };

describe("SemanticTokenIndex", () => {
    // [2..4) type 0, [6..9) type 1, [9..10) type 0.
    const line = { legend: LEGEND, tokens: [2, 4, 0, 0, 6, 9, 1, 5, 9, 10, 0, 2] };
    const lookup = (legend: ISemanticTokensLegend, type: number, mods: number) => ({
        fg: legend === LEGEND ? type * 100 + mods : -1,
    });

    it("outside tokens — null, inside — the style of its token", () => {
        const index = new SemanticTokenIndex(line, lookup);
        const at = (offset: number) => index.styleAt(offset)?.fg ?? null;
        expect([0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11].map(at)).toEqual([
            null,
            null,
            0,
            0,
            null,
            null,
            105,
            105,
            2,
            null,
            null,
        ]);
    });

    it("going back after a forward pass finds the token from the start", () => {
        const index = new SemanticTokenIndex(line, lookup);
        expect(index.styleAt(9)?.fg).toBe(2);
        expect(index.styleAt(3)?.fg).toBe(0);
        expect(index.styleAt(7)?.fg).toBe(105);
        // The cursor went past the last token; it rewinds from there too.
        expect(index.styleAt(11)).toBeNull();
        expect(index.styleAt(3)?.fg).toBe(0);
    });

    it("lookup returned null — no style", () => {
        const index = new SemanticTokenIndex(line, () => null);
        expect(index.styleAt(3)).toBeNull();
    });

    it("empty token line", () => {
        expect(new SemanticTokenIndex({ legend: LEGEND, tokens: [] }, lookup).styleAt(0)).toBeNull();
    });
});

describe("resolveSemanticTokenStyle", () => {
    function recorder(): ISemanticTokenStyleResolver & { calls: unknown[] } {
        const calls: unknown[] = [];
        return {
            calls,
            semanticHighlighting: true,
            onDidChange: Event.None,
            resolve: (type, modifiers, languageId) => {
                calls.push([type, [...modifiers], languageId]);
                return { bold: true };
            },
        };
    }

    it("type index and modifier bits map to legend names, language as is", () => {
        const resolver = recorder();
        expect(resolveSemanticTokenStyle(resolver, "ts", LEGEND, 1, 0b101)).toEqual({ bold: true });
        expect(resolver.calls).toEqual([["b", ["m0", "m2"], "ts"]]);
    });

    it("bits beyond the legend are dropped; no modifiers yields an empty list", () => {
        const resolver = recorder();
        resolveSemanticTokenStyle(resolver, "ts", LEGEND, 0, 0b1010);
        resolveSemanticTokenStyle(resolver, "ts", LEGEND, 0, 0);
        expect(resolver.calls).toEqual([
            ["a", ["m1"], "ts"],
            ["a", [], "ts"],
        ]);
    });

    it("the high (sign) bit does not break decoding", () => {
        const resolver = recorder();
        const legend = { tokenTypes: ["a"], tokenModifiers: Array.from({ length: 32 }, (_, i) => `m${String(i)}`) };
        resolveSemanticTokenStyle(resolver, "ts", legend, 0, 0x8000_0000);
        expect(resolver.calls).toEqual([["a", ["m31"], "ts"]]);
    });

    it("a type outside the legend or empty — null without calling the theme", () => {
        const resolver = recorder();
        expect(resolveSemanticTokenStyle(resolver, "ts", LEGEND, 7, 0)).toBeNull();
        expect(resolveSemanticTokenStyle(resolver, "ts", LEGEND, 2, 0)).toBeNull();
        expect(resolver.calls).toEqual([]);
    });
});

describe("applySemanticStyle", () => {
    const ALL = StyleFlags.Bold | StyleFlags.Italic | StyleFlags.Underline | StyleFlags.Strikethrough;

    it("an empty style changes nothing", () => {
        expect(applySemanticStyle({}, 7, ALL)).toEqual({ fg: 7, flags: ALL });
    });

    it("color is replaced, flags are set and cleared one by one", () => {
        expect(applySemanticStyle({ fg: 9, bold: false, underline: true }, 7, StyleFlags.Bold)).toEqual({
            fg: 9,
            flags: StyleFlags.Underline,
        });
        expect(applySemanticStyle({ italic: true, strikethrough: true }, 7, 0)).toEqual({
            fg: 7,
            flags: StyleFlags.Italic | StyleFlags.Strikethrough,
        });
        expect(applySemanticStyle({ bold: true, italic: false, strikethrough: false }, 7, ALL)).toEqual({
            fg: 7,
            flags: StyleFlags.Bold | StyleFlags.Underline,
        });
        expect(applySemanticStyle({ underline: false }, 7, ALL)).toEqual({
            fg: 7,
            flags: StyleFlags.Bold | StyleFlags.Italic | StyleFlags.Strikethrough,
        });
    });
});
