import { describe, expect, it } from "vitest";

import { getCharDisplayWidth } from "@tuidom/core/common/unicodeWidth";

import { CODICON_GLYPHS } from "./codicons.generated.ts";
import { codicon, iconGlyph, renderCodicons } from "./codicons.ts";
import { CODICON_UNICODE } from "./codiconsUnicode.ts";

const CHECK = CODICON_GLYPHS.check;
const SYNC = CODICON_GLYPHS.sync;

describe("renderCodicons", () => {
    it("leaves text without markup as is", () => {
        expect(renderCodicons("Ln 1, Col 1", true)).toBe("Ln 1, Col 1");
    });

    it("replaces a known icon with the font glyph", () => {
        expect(CHECK).toBeDefined();
        expect(renderCodicons("$(check) Ready", true)).toBe(`${CHECK ?? ""} Ready`);
    });

    it("replaces several icons in one string", () => {
        expect(renderCodicons("$(check)a$(sync)b", true)).toBe(`${CHECK ?? ""}a${SYNC ?? ""}b`);
    });

    it("ignores the animation modifier", () => {
        expect(renderCodicons("$(sync~spin)", true)).toBe(SYNC);
    });

    it("ignores a modifier with an empty name", () => {
        expect(renderCodicons("$(sync~)", true)).toBe(SYNC);
    });

    it("drops an unknown name", () => {
        expect(renderCodicons("x$(definitely-not-a-codicon)y", true)).toBe("xy");
    });

    it("leaves alone what is not icon markup", () => {
        expect(renderCodicons("$notAnIcon ($5) $()", true)).toBe("$notAnIcon ($5) $()");
    });

    it("unescapes, leaving the literal", () => {
        expect(renderCodicons("\\$(check)", true)).toBe("$(check)");
    });

    it("matches the name case-insensitively (like upstream)", () => {
        expect(renderCodicons("$(CHECK)", true)).toBe(CHECK);
    });

    it("the code point table arrived in full", () => {
        // The lower bound guards against "the generator produced an empty table and tests are green".
        expect(Object.keys(CODICON_GLYPHS).length).toBeGreaterThan(700);
    });
});

describe("renderCodicons without Nerd Font", () => {
    it("replaces a known icon with its Unicode fallback", () => {
        expect(renderCodicons("$(check) Ready", false)).toBe("✓ Ready");
    });

    it("drops a name without a fallback: the literal never reaches the frame", () => {
        expect(CODICON_GLYPHS.beaker).toBeDefined();
        expect(CODICON_UNICODE.beaker).toBeUndefined();
        expect(renderCodicons("x$(beaker)y", false)).toBe("xy");
    });

    it("drops an unknown name and unescapes the escaped one, as with Nerd Font", () => {
        expect(renderCodicons("x$(definitely-not-a-codicon)y", false)).toBe("xy");
        expect(renderCodicons("\\$(check)", false)).toBe("$(check)");
    });

    it("matches the name case-insensitively and ignores the modifier", () => {
        expect(renderCodicons("$(SYNC~spin)", false)).toBe("↻");
    });
});

describe("codicon fallback table", () => {
    const entries = Object.entries(CODICON_UNICODE);

    it("has no Private Use Area character", () => {
        const pua = entries.filter(([, char]) => /[\uE000-\uF8FF]|[\u{F0000}-\u{10FFFF}]/u.test(char ?? ""));
        expect(pua).toEqual([]);
    });

    it("holds single one-cell code points: no emoji, no wide character, no variation selector", () => {
        const bad = entries.filter(([, char]) => {
            const points = Array.from(char ?? "");
            return points.length !== 1 || getCharDisplayWidth(points[0].codePointAt(0) ?? 0) !== 1;
        });
        expect(bad).toEqual([]);
    });

    it("names only real codicons", () => {
        expect(entries.filter(([name]) => CODICON_GLYPHS[name] === undefined)).toEqual([]);
    });
});

describe("codicon", () => {
    it("carries both glyph sets of a name", () => {
        const icon = codicon("lock");
        expect(iconGlyph(icon, true)).toBe(CODICON_GLYPHS.lock);
        expect(iconGlyph(icon, false)).toBe("•");
    });

    it("gives an empty glyph for a name a table lacks", () => {
        expect(codicon("beaker").unicode).toBe("");
        expect(codicon("definitely-not-a-codicon")).toEqual({ nerdFont: "", unicode: "" });
    });
});
