import { packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import type { ICoreCompletionItem } from "../../../../editor/common/languages/iCompletionSource.ts";

import { completionItemColor } from "./completionItemColor.ts";

function color(fields: Partial<ICoreCompletionItem>): number | undefined {
    return completionItemColor({ label: "x", insertText: "x", kind: 15, ...fields });
}

describe("completionItemColor — upstream ColorExtractor", () => {
    it("takes the whole label, then the whole detail, case-insensitive", () => {
        expect(color({ label: "#FF0000" })).toBe(packRgb(255, 0, 0));
        expect(color({ label: "red", detail: "rgb(0, 128, 0)" })).toBe(packRgb(0, 128, 0));
        expect(color({ label: "#ff0000", detail: "#00ff00" })).toBe(packRgb(255, 0, 0));
        expect(color({ label: "red #ff0000" })).toBeUndefined();
        expect(color({ detail: "color: #ff0000" })).toBeUndefined();
    });

    it("takes a color at the start or the end of the documentation, not in the middle", () => {
        expect(color({ documentation: "#fe9a00" })).toBe(packRgb(0xfe, 0x9a, 0x00));
        expect(color({ documentation: "#abc is a color" })).toBe(packRgb(0xaa, 0xbb, 0xcc));
        expect(color({ documentation: "the color hsl(0, 100%, 50%)" })).toBe(packRgb(255, 0, 0));
        expect(color({ documentation: "a #ff0000 b" })).toBeUndefined();
        expect(color({ documentation: "inherit" })).toBeUndefined();
    });

    it("keeps translucency", () => {
        expect(color({ documentation: "rgba(255, 0, 0, 0.5)" })).toBe(packRgba(255, 0, 0, 128));
    });

    it("only for the Color kind; a text the computer cannot parse keeps the icon", () => {
        expect(color({ kind: 9, label: "#ff0000" })).toBeUndefined();
        expect(completionItemColor({ label: "#ff0000", insertText: "#ff0000" })).toBeUndefined();
        expect(color({ documentation: "rgb(10%, 20%, 30%)" })).toBeUndefined();
    });
});
