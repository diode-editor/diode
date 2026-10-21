import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { tokenMetadata } from "../../../../TestUtils/encodedTokens.ts";
import { ColorId, FontStyle, StandardTokenType } from "../encodedTokenAttributes.ts";

import { ColorMapTokenStyleResolver } from "./colorMapTokenStyleResolver.ts";

const COLOR_MAP = ["", "#CCCCCC", "#1F1F1F", "#FF0000", "#00FF00"];

function resolverFor(colorMap: readonly string[] | null): ColorMapTokenStyleResolver {
    return new ColorMapTokenStyleResolver({ getColorMap: () => colorMap });
}

describe("ColorMapTokenStyleResolver", () => {
    it("foreground comes from colorMap by index", () => {
        const style = resolverFor(COLOR_MAP).resolve(tokenMetadata({ foreground: 3 }));
        expect(style.fg).toBe(packRgb(0xff, 0, 0));
        expect(style.bg).toBeUndefined();
    });

    it("default colors (ColorId 0..1 for foreground, 0..2 for background) — undefined: the cell takes the editor colors", () => {
        const resolver = resolverFor(COLOR_MAP);
        expect(resolver.resolve(tokenMetadata({ foreground: ColorId.DefaultForeground })).fg).toBeUndefined();
        expect(resolver.resolve(tokenMetadata({ foreground: ColorId.None })).fg).toBeUndefined();
        expect(resolver.resolve(tokenMetadata({ background: ColorId.DefaultBackground })).bg).toBeUndefined();
        expect(resolver.resolve(tokenMetadata({ background: ColorId.DefaultForeground })).bg).toBeUndefined();
        // Index 2 for foreground is not a "default" but the editor background color.
        expect(resolver.resolve(tokenMetadata({ foreground: ColorId.DefaultBackground })).fg).toBe(
            packRgb(0x1f, 0x1f, 0x1f),
        );
    });

    it("background comes from colorMap for an index above 2", () => {
        expect(resolverFor(COLOR_MAP).resolve(tokenMetadata({ background: 4 })).bg).toBe(packRgb(0, 0xff, 0));
    });

    it("each FontStyle bit is its own flag", () => {
        const resolver = resolverFor(COLOR_MAP);
        expect(resolver.resolve(tokenMetadata({ fontStyle: FontStyle.Bold }))).toMatchObject({
            bold: true,
            italic: false,
            underline: false,
            strikethrough: false,
        });
        expect(resolver.resolve(tokenMetadata({ fontStyle: FontStyle.Italic }))).toMatchObject({
            bold: false,
            italic: true,
            underline: false,
            strikethrough: false,
        });
        expect(resolver.resolve(tokenMetadata({ fontStyle: FontStyle.Underline }))).toMatchObject({
            bold: false,
            italic: false,
            underline: true,
            strikethrough: false,
        });
        expect(resolver.resolve(tokenMetadata({ fontStyle: FontStyle.Strikethrough }))).toMatchObject({
            bold: false,
            italic: false,
            underline: false,
            strikethrough: true,
        });
    });

    it("an index outside colorMap or an empty slot — undefined", () => {
        const resolver = resolverFor(COLOR_MAP);
        expect(resolver.resolve(tokenMetadata({ foreground: 100 })).fg).toBeUndefined();
        expect(
            resolverFor(["", "#CCCCCC", "#1F1F1F", ""]).resolve(tokenMetadata({ foreground: 3 })).fg,
        ).toBeUndefined();
    });

    it("no theme yet (colorMap null) — no colors, font style is present", () => {
        const style = resolverFor(null).resolve(tokenMetadata({ foreground: 3, fontStyle: FontStyle.Bold }));
        expect(style.fg).toBeUndefined();
        expect(style.bold).toBe(true);
    });

    it("style is cached by style bits: token type and language do not affect it", () => {
        const resolver = resolverFor(COLOR_MAP);
        const a = resolver.resolve(tokenMetadata({ foreground: 3, tokenType: StandardTokenType.Comment }));
        const b = resolver.resolve(tokenMetadata({ foreground: 3, tokenType: StandardTokenType.String }) | 7);
        expect(b).toBe(a);
        expect(resolver.resolve(tokenMetadata({ foreground: 4 }))).not.toBe(a);
    });

    it("a new colorMap on the source (theme change) — colors and cache are recomputed", () => {
        let colorMap: readonly string[] = COLOR_MAP;
        const resolver = new ColorMapTokenStyleResolver({ getColorMap: () => colorMap });
        const before = resolver.resolve(tokenMetadata({ foreground: 3 }));
        expect(before.fg).toBe(packRgb(0xff, 0, 0));

        colorMap = ["", "#CCCCCC", "#1F1F1F", "#0000FF"];
        const after = resolver.resolve(tokenMetadata({ foreground: 3 }));
        expect(after.fg).toBe(packRgb(0, 0, 0xff));
        expect(after).not.toBe(before);
    });
});
