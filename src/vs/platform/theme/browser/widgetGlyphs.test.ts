import { GLYPH_TOKEN_DEFAULTS, type GlyphToken } from "@tuidom/core/dom/glyphTokens";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { createSwitchableIcons } from "../../../../TestUtils/switchableIcons.ts";
import { StaticProductIconService } from "../common/productIconService.ts";

import { bindWidgetGlyphs, computeWidgetGlyphs } from "./widgetGlyphs.ts";

const PUA = /[\uE000-\uF8FF]|[\u{F0000}-\u{10FFFF}]/u;
const TOKENS = Object.keys(GLYPH_TOKEN_DEFAULTS) as GlyphToken[];

describe("computeWidgetGlyphs", () => {
    it("Nerd Font mode keeps the tuidom defaults", () => {
        expect(computeWidgetGlyphs(new StaticProductIconService(true))).toBeNull();
    });

    it("off: every widget glyph is one BMP character outside the Private Use Area", () => {
        const glyphs = computeWidgetGlyphs(new StaticProductIconService(false))!;
        for (const token of TOKENS) {
            const glyph = glyphs[token] ?? "";
            // One UTF-16 code unit: a single BMP code point, no surrogate pair, no variation selector.
            expect([token, glyph.length, PUA.test(glyph)]).toEqual([token, 1, false]);
        }
    });

    it("off: chevrons as view headers, the lock of a locked group, kinds by meaning", () => {
        const glyphs = computeWidgetGlyphs(new StaticProductIconService(false))!;
        expect(glyphs["tree.expanded"]).toBe("▾");
        expect(glyphs["tree.collapsed"]).toBe("▸");
        expect(glyphs["editorTab.readOnly"]).toBe("•");
        expect(glyphs["completionKind.method"]).toBe("ƒ");
        expect(glyphs["completionKind.function"]).toBe("ƒ");
        expect(glyphs["completionKind.class"]).toBe("▭");
        expect(glyphs["completionKind.text"]).toBe("·");
    });
});

describe("bindWidgetGlyphs", () => {
    it("puts the table into the root and follows the setting live", async () => {
        const { icons, set } = createSwitchableIcons(false);
        const root = new TUIElement();
        const binding = bindWidgetGlyphs(root, icons);
        expect(root.glyph("tree.expanded")).toBe("▾");

        await set(true);
        expect(root.glyph("tree.expanded")).toBe(GLYPH_TOKEN_DEFAULTS["tree.expanded"]);

        await set(false);
        expect(root.glyph("tree.expanded")).toBe("▾");

        binding.dispose();
        await set(true);
        expect(root.glyph("tree.expanded")).toBe("▾");
    });
});
