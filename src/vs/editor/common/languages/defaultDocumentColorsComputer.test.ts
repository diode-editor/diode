import { describe, expect, it } from "vitest";

import type { IPosition } from "../core/iPosition.ts";

import { computeDefaultDocumentColors, type IDocumentColorComputerTarget } from "./defaultDocumentColorsComputer.ts";

class TestDocumentModel implements IDocumentColorComputerTarget {
    public constructor(private readonly content: string) {}

    public positionAt(offset: number): IPosition {
        const lines = this.content.substring(0, offset).split("\n");
        return { line: lines.length - 1, character: lines[lines.length - 1].length };
    }

    public findMatches(regex: RegExp): RegExpExecArray[] {
        return [...this.content.matchAll(regex)];
    }
}

function colorsOf(content: string): ReturnType<typeof computeDefaultDocumentColors> {
    return computeDefaultDocumentColors(new TestDocumentModel(content));
}

// Ported from upstream `defaultDocumentColorsComputer.test.ts`.
describe("Default Document Colors Computer", () => {
    it("hex colors in strings should be detected", () => {
        const colors = colorsOf(`const color = '#ff0000';`);
        expect(colors).toHaveLength(1);
        expect(colors[0].color).toEqual({ red: 1, green: 0, blue: 0, alpha: 1 });
    });

    it("hex colors in double quotes should be detected", () => {
        const colors = colorsOf('const color = "#00ff00";');
        expect(colors).toHaveLength(1);
        expect(colors[0].color).toMatchObject({ red: 0, green: 1, blue: 0 });
    });

    it("multiple hex colors in array should be detected", () => {
        const colors = colorsOf(`const colors = ['#ff0000', '#00ff00', '#0000ff'];`);
        expect(colors.map((c) => c.color)).toEqual([
            { red: 1, green: 0, blue: 0, alpha: 1 },
            { red: 0, green: 1, blue: 0, alpha: 1 },
            { red: 0, green: 0, blue: 1, alpha: 1 },
        ]);
    });

    it.each([`const color = ' #ff0000';`, "#ff0000", "  #ff0000"])(
        "existing functionality still works: %s",
        (content) => {
            expect(colorsOf(content)).toHaveLength(1);
        },
    );

    it("8-digit hex colors should also work", () => {
        const colors = colorsOf(`const color = '#ff0000ff';`);
        expect(colors).toHaveLength(1);
        expect(colors[0].color).toEqual({ red: 1, green: 0, blue: 0, alpha: 1 });
    });

    it.each([
        "hsl(253, 100.00%, 47.10%)",
        "hsl(253, 100%, 47.10%)",
        "hsl(0, 83.60%, 47.80%)",
        "hsl(253.5, 100%, 50%)",
        "hsl(360.0, 50%, 50%)",
        "hsl(100.5, 50.5%, 50.5%)",
        "hsl(0.5, 50%, 50%)",
        "hsl(359.9, 100%, 50%)",
        "hsla(253.5, 100%, 50%, 0.5)",
        "hsla(360.0, 50.5%, 50.5%, 1)",
        "hsla(0.5, 50%, 50%, 0.25)",
        "hsl(253 100% 50%)",
        "hsl(253.5 100% 50%)",
        "hsla(253 100% 50% / 0.5)",
        "hsla(253.5 100% 50% / 0.5)",
        "hsla(253 100% 50% / 1)",
        "rgb(255 0 0)",
        "rgb(128 128 128)",
        "rgba(255 0 0 / 0.5)",
        "rgba(128 128 128 / 0.8)",
        "rgba(255 0 0 / 1)",
        "rgb(255, 0, 0)",
        "rgba(255, 0, 0, 0.5)",
    ])("detects %s", (color) => {
        expect(colorsOf(`const color = ${color};`)).toHaveLength(1);
    });
});

describe("Default Document Colors Computer — diode", () => {
    it("ranges are 0-based and cover the color text", () => {
        const colors = colorsOf("a {\n  color: #ff0000; background: rgb(0, 0, 255);\n}");
        expect(colors.map((c) => c.range)).toEqual([
            { start: { line: 1, character: 9 }, end: { line: 1, character: 16 } },
            { start: { line: 1, character: 30 }, end: { line: 1, character: 44 } },
        ]);
    });

    it.each([
        ["#f00", { red: 1, green: 0, blue: 0, alpha: 1 }],
        ["#f008", { red: 1, green: 0, blue: 0, alpha: 0.533 }],
        ["#ff000080", { red: 1, green: 0, blue: 0, alpha: 0.502 }],
        ["#0000ff", { red: 0, green: 0, blue: 1, alpha: 1 }],
        ["rgba(255, 0, 0, 0.5)", { red: 1, green: 0, blue: 0, alpha: 0.5 }],
        ["rgba(255 0 0 / .5)", { red: 1, green: 0, blue: 0, alpha: 0.5 }],
        ["hsl(120, 100%, 50%)", { red: 0, green: 1, blue: 0, alpha: 1 }],
        ["hsl(240, 100%, 50%)", { red: 0, green: 0, blue: 1, alpha: 1 }],
        ["hsl(0, 0%, 50%)", { red: 128 / 255, green: 128 / 255, blue: 128 / 255, alpha: 1 }],
        ["hsl(0, 100%, 75%)", { red: 1, green: 128 / 255, blue: 128 / 255, alpha: 1 }],
        ["hsl(60, 100%, 50%)", { red: 1, green: 1, blue: 0, alpha: 1 }],
        ["hsl(300, 100%, 50%)", { red: 1, green: 0, blue: 1, alpha: 1 }],
        ["hsla(120, 100%, 50%, 0.5)", { red: 0, green: 1, blue: 0, alpha: 0.5 }],
    ])("parses %s", (text, color) => {
        const colors = colorsOf(`x: ${text};`);
        expect(colors).toHaveLength(1);
        expect(colors[0].color).toEqual(color);
    });

    it.each([
        "a#fff",
        "a#f00f",
        "a#ff0000",
        "a#ff0000ff",
        "#ggg",
        "#zzzz",
        "#zzzzzzzz",
        " #12345",
        " #ff00f",
        "rgb(300,0,0)",
        "rgb(1,2)",
        "hsl(400, 50%, 50%)",
        "rgba(1,2,3)",
    ])("%s is not a color", (text) => {
        expect(colorsOf(text)).toEqual([]);
    });

    it.each(["#f008", "#ff000080", "x\n#f008", "x\n#ff000080"])("%j: a hex color at a line start", (text) => {
        expect(colorsOf(text)).toHaveLength(1);
    });

    it("a hex color at the start of a later line is found (multiline)", () => {
        const colors = colorsOf("x\n#abc");
        expect(colors.map((c) => c.range.start)).toEqual([{ line: 1, character: 0 }]);
    });
});

/**
 * Every alternative of upstream's number patterns in every position, with each separator form: a value outside
 * the alternative it is meant for must not slip through another one.
 */
describe("Default Document Colors Computer — the parameter grammar", () => {
    const BYTES = [255, 249, 199, 42, 7];
    const rows = BYTES.map((_, i) => [0, 1, 2].map((k) => BYTES[(i + k) % BYTES.length]));
    const forms: readonly ((v: readonly number[]) => string)[] = [
        (v) => v.join(","),
        (v) => ` ${v.join(" , ")} `,
        (v) => v.join(" "),
    ];

    it.each(rows.flatMap((row) => forms.map((form) => `rgb(${form(row)})`)))("%s", (text) => {
        const colors = colorsOf(`x: ${text}`);
        expect(colors).toHaveLength(1);
        const values = text.match(/\d+/g)!.map(Number);
        expect(colors[0].color).toEqual({
            red: values[0] / 255,
            green: values[1] / 255,
            blue: values[2] / 255,
            alpha: 1,
        });
    });

    it.each([
        ["0.25", 0.25],
        [".25", 0.25],
        ["1.", 1],
        ["0", 0],
        ["1", 1],
    ])("rgba alpha %s, after a comma, a space and a slash", (alpha, value) => {
        for (const params of [
            `255,7,42,${alpha}`,
            `255 7 42 ${alpha}`,
            `255 7 42 / ${alpha}`,
            ` 255 , 7 , 42 , ${alpha} `,
        ]) {
            const colors = colorsOf(`x: rgba(${params})`);
            expect(colors.map((c) => c.color.alpha)).toEqual([value]);
        }
    });

    it.each(["360", "360.00", "360.5", "359.75", "305", "299", "125.25", "199", "42.5", "7"])("hue %s", (hue) => {
        for (const text of [`hsl(${hue},50%,50%)`, `hsl( ${hue} , 50% , 50% )`, `hsl(${hue} 50% 50%)`]) {
            expect(colorsOf(`x: ${text}`)).toHaveLength(1);
        }
        for (const text of [`hsla(${hue},50%,50%,1)`, `hsla( ${hue} , 50% , 50% / 1 )`, `hsla(${hue} 50% 50% 1)`]) {
            expect(colorsOf(`x: ${text}`)).toHaveLength(1);
        }
    });

    it.each(["100", "100.00", "50.5", "5.", "5", "50"])("saturation and lightness %s%%", (percent) => {
        for (const text of [
            `hsl(0, ${percent}%, 50%)`,
            `hsl(0, 50%, ${percent}%)`,
            `hsl(0 ${percent}% 50%)`,
            `hsla(0, ${percent}%, 50%, 1)`,
            `hsla(0, 50%, ${percent}%, 1)`,
        ]) {
            expect(colorsOf(`x: ${text}`)).toHaveLength(1);
        }
    });

    it.each([
        ["0.25", 0.25],
        [".25", 0.25],
        ["1.", 1],
        ["1.00", 1],
        ["0", 0],
        ["1", 1],
    ])("hsla alpha %s", (alpha, value) => {
        for (const params of [`0,50%,50%,${alpha}`, `0 50% 50% / ${alpha}`, `0 50% 50% ${alpha}`]) {
            expect(colorsOf(`x: hsla(${params})`).map((c) => c.color.alpha)).toEqual([value]);
        }
    });

    it("saturation and lightness are percentages", () => {
        expect(colorsOf("x: hsl(0, 50%, 50%)")[0].color).toEqual({
            red: 191 / 255,
            green: 64 / 255,
            blue: 64 / 255,
            alpha: 1,
        });
        expect(colorsOf("x: hsla(0, 50%, 25%, 0.5)")[0].color).toEqual({
            red: 96 / 255,
            green: 32 / 255,
            blue: 32 / 255,
            alpha: 0.5,
        });
    });

    it.each([
        "rgb(256,0,0)",
        "rgb(260,0,0)",
        "rgb(300,0,0)",
        "rgb(0,0,1000)",
        "rgb(01,0,0)",
        "rgb(1,2,3,4)",
        "rgba(1,2,3,2)",
        "rgba(1,2,3,1.5)",
        "rgba(1,2,3)",
        "hsl(361, 50%, 50%)",
        "hsl(370, 50%, 50%)",
        "hsl(400, 50%, 50%)",
        "hsl(0, 101%, 50%)",
        "hsl(0, 50, 50%)",
        "hsl(0, 100.5%, 50%)",
        "hsla(0, 50%, 50%, 2)",
        "hsla(0, 50%, 50%)",
    ])("%s is not a color", (text) => {
        expect(colorsOf(`x: ${text}`)).toEqual([]);
    });
});
