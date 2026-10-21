import { describe, expect, it } from "vitest";

import { CODICON_GLYPHS } from "./codicons.generated.ts";
import { renderCodicons } from "./codicons.ts";

const CHECK = CODICON_GLYPHS.check;
const SYNC = CODICON_GLYPHS.sync;

describe("renderCodicons", () => {
    it("leaves text without markup as is", () => {
        expect(renderCodicons("Ln 1, Col 1")).toBe("Ln 1, Col 1");
    });

    it("replaces a known icon with the font glyph", () => {
        expect(CHECK).toBeDefined();
        expect(renderCodicons("$(check) Ready")).toBe(`${CHECK ?? ""} Ready`);
    });

    it("replaces several icons in one string", () => {
        expect(renderCodicons("$(check)a$(sync)b")).toBe(`${CHECK ?? ""}a${SYNC ?? ""}b`);
    });

    it("ignores the animation modifier", () => {
        expect(renderCodicons("$(sync~spin)")).toBe(SYNC);
    });

    it("ignores a modifier with an empty name", () => {
        expect(renderCodicons("$(sync~)")).toBe(SYNC);
    });

    it("drops an unknown name", () => {
        expect(renderCodicons("x$(definitely-not-a-codicon)y")).toBe("xy");
    });

    it("leaves alone what is not icon markup", () => {
        expect(renderCodicons("$notAnIcon ($5) $()")).toBe("$notAnIcon ($5) $()");
    });

    it("unescapes, leaving the literal", () => {
        expect(renderCodicons("\\$(check)")).toBe("$(check)");
    });

    it("matches the name case-insensitively (like upstream)", () => {
        expect(renderCodicons("$(CHECK)")).toBe(CHECK);
    });

    it("the code point table arrived in full", () => {
        // The lower bound guards against "the generator produced an empty table and tests are green".
        expect(Object.keys(CODICON_GLYPHS).length).toBeGreaterThan(700);
    });
});
