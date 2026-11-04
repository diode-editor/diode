import { describe, expect, it } from "vitest";

import { HSLA, parseCssColor, parseHex, RGBA } from "./color.ts";

function channels(rgba: RGBA | null): [number, number, number, number] | null {
    return rgba === null ? null : [rgba.r, rgba.g, rgba.b, rgba.a];
}

describe("RGBA", () => {
    it("clamps channels into [0, 255] as integers, alpha into [0, 1] rounded to 3 decimals", () => {
        expect(channels(new RGBA(-5, 300, 12.9, 2))).toEqual([0, 255, 12, 1]);
        expect(channels(new RGBA(1, 2, 3, -1))).toEqual([1, 2, 3, 0]);
        expect(channels(new RGBA(1, 2, 3, 0.12345))).toEqual([1, 2, 3, 0.123]);
        expect(new RGBA(1, 2, 3).a).toBe(1);
    });
});

describe("HSLA", () => {
    it("clamps hue into [0, 360] as an integer, the rest into [0, 1] rounded to 3 decimals", () => {
        const hsla = new HSLA(400.7, 1.5, -0.2, 0.33333);
        expect([hsla.h, hsla.s, hsla.l, hsla.a]).toEqual([360, 1, 0, 0.333]);
        const low = new HSLA(-3, -1, 2, 2);
        expect([low.h, low.s, low.l, low.a]).toEqual([0, 0, 1, 1]);
        expect(new HSLA(120.9, 0.5, 0.5, 1).h).toBe(120);
    });

    it.each([
        [0, 1, 0.5, [255, 0, 0]],
        [30, 1, 0.5, [255, 128, 0]],
        [60, 1, 0.5, [255, 255, 0]],
        [120, 1, 0.5, [0, 255, 0]],
        [180, 1, 0.5, [0, 255, 255]],
        [240, 1, 0.5, [0, 0, 255]],
        [300, 1, 0.5, [255, 0, 255]],
        [330, 1, 0.5, [255, 0, 128]],
        [360, 1, 0.5, [255, 0, 0]],
        [0, 0, 0.5, [128, 128, 128]],
        [0, 1, 0.25, [128, 0, 0]],
        [0, 1, 0.75, [255, 128, 128]],
        [210, 0.5, 0.4, [51, 102, 153]],
        [30, 1, 0.75, [255, 191, 128]],
        [0, 0.5, 0.75, [223, 159, 159]],
    ])("hsl(%d, %d, %d) is rgb %j", (h, s, l, rgb) => {
        expect(channels(HSLA.toRGBA(new HSLA(h, s, l, 0.5)))).toEqual([...rgb, 0.5]);
    });
});

describe("parseHex", () => {
    it.each([
        ["#ff8000", [255, 128, 0, 1]],
        ["#FF800080", [255, 128, 0, 0.502]],
        ["#f80", [255, 136, 0, 1]],
        ["#f808", [255, 136, 0, 0.533]],
        ["#0a1B2c", [10, 27, 44, 1]],
        ["#0a1B2c3d", [10, 27, 44, 0.239]],
    ])("%s", (hex, rgba) => {
        expect(channels(parseHex(hex))).toEqual(rgba);
    });

    it.each(["", "ff8000", "xff8000", "xff800080", "#", "#ff", "#ff800", "#ff80000", "#ff8000000"])(
        "%j is not a color",
        (hex) => {
            expect(parseHex(hex)).toBeNull();
        },
    );

    it("a digit outside 0-9a-f counts as 0, as upstream", () => {
        expect(channels(parseHex("#gg80zz"))).toEqual([0, 128, 0, 1]);
        expect(channels(parseHex("#8g8"))).toEqual([136, 0, 136, 1]);
    });
});

describe("parseCssColor", () => {
    it.each([
        ["#ff8000", [255, 128, 0, 1]],
        ["#FF800080", [255, 128, 0, 0.502]],
        ["#f80", [255, 136, 0, 1]],
        ["#f808", [255, 136, 0, 0.533]],
        ["rgb(1, 2, 3)", [1, 2, 3, 1]],
        ["rgb(1,2,3)", [1, 2, 3, 1]],
        ["RGB( 1 , 2 , 3 )", [1, 2, 3, 1]],
        ["rgba(255,0,0,0.3)", [255, 0, 0, 0.3]],
        ["rgba(255, 100, 100, 0.15)", [255, 100, 100, 0.15]],
        ["rgba(255, 0, 0, .5)", [255, 0, 0, 0.5]],
        ["rgba(10, 20, 30, 0)", [10, 20, 30, 0]],
        ["transparent", [0, 0, 0, 0]],
        ["red", [255, 0, 0, 1]],
        ["rebeccapurple", [102, 51, 153, 1]],
        ["yellowgreen", [154, 205, 50, 1]],
        ["aliceblue", [240, 248, 255, 1]],
    ])("%s", (css, rgba) => {
        expect(channels(parseCssColor(css))).toEqual(rgba);
    });

    it("fractional channels are rounded like a browser does (Tailwind sends floats)", () => {
        expect(channels(parseCssColor("rgba(239.00000000000003, 68, 68, 1)"))).toEqual([239, 68, 68, 1]);
        expect(channels(parseCssColor("rgb(10.5, 0.6, 1e2)"))).toEqual([11, 1, 100, 1]);
    });

    it("channels are clamped into [0, 255], alpha into [0, 1]", () => {
        expect(channels(parseCssColor("rgb(-5, 300, +7)"))).toEqual([0, 255, 7, 1]);
        expect(channels(parseCssColor("rgba(1, 2, 3, 2)"))).toEqual([1, 2, 3, 1]);
        expect(channels(parseCssColor("rgba(1, 2, 3, -1)"))).toEqual([1, 2, 3, 0]);
    });

    it.each([
        "",
        "#ggg",
        "#ff80f",
        "#12345",
        "rgba(1,2)",
        "rgb(1, 2, 3, 4)",
        "rgba(1, 2, 3)",
        "rgb(a, b, c)",
        "rgb(1, 2, 3",
        "xrgb(1, 2, 3)",
        "rgb(1, 2, 3)x",
        // A non-ASCII word.
        "\u043a\u0438\u0440\u043f\u0438\u0447",
        "Red",
        "constructor",
        "hsl(0, 100%, 50%)",
    ])("%j is not a color, without an exception", (css) => {
        expect(parseCssColor(css)).toBeNull();
    });
});
