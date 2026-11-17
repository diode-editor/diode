import { packRgb } from "@tuidom/core/common/colorUtils";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { describe, expect, it } from "vitest";

import { calcANSI8bitColor, handleANSIOutput } from "./debugANSIHandling.ts";

const ESC = "\u001b";

describe("handleANSIOutput", () => {
    it("keeps plain text as one unstyled run", () => {
        expect(handleANSIOutput("plain")).toStrictEqual([{ text: "plain" }]);
        expect(handleANSIOutput("")).toStrictEqual([]);
    });

    it("paints the 16 colors with the terminal's theme colors, foreground and background", () => {
        expect(handleANSIOutput(`${ESC}[31mred${ESC}[0m done`)).toStrictEqual([
            { text: "red", fg: "terminal.ansiRed" },
            { text: " done" },
        ]);
        expect(handleANSIOutput(`${ESC}[92;104mx`)).toStrictEqual([
            { text: "x", fg: "terminal.ansiBrightGreen", bg: "terminal.ansiBrightBlue" },
        ]);
        expect(handleANSIOutput(`${ESC}[47mx${ESC}[39;49my`)).toStrictEqual([
            { text: "x", bg: "terminal.ansiWhite" },
            { text: "y" },
        ]);
    });

    it("turns the formatting on and off", () => {
        const on = handleANSIOutput(`${ESC}[1;2;3;4;9mx`);
        expect(on).toStrictEqual([
            {
                text: "x",
                style:
                    StyleFlags.Bold |
                    StyleFlags.Dim |
                    StyleFlags.Italic |
                    StyleFlags.Underline |
                    StyleFlags.Strikethrough,
            },
        ]);
        expect(handleANSIOutput(`${ESC}[1;2;3;4;9m${ESC}[22;23;24;29mx`)).toStrictEqual([{ text: "x" }]);
        expect(handleANSIOutput(`${ESC}[21mx${ESC}[4my${ESC}[24mz`)).toStrictEqual([
            { text: "x", style: StyleFlags.Underline },
            { text: "y", style: StyleFlags.Underline },
            { text: "z" },
        ]);
        // A repeated code does not stack.
        expect(handleANSIOutput(`${ESC}[1m${ESC}[1mx${ESC}[0my`)).toStrictEqual([
            { text: "x", style: StyleFlags.Bold },
            { text: "y" },
        ]);
    });

    it("drops what a cell cannot show", () => {
        // blink, hidden, a font, overline, superscript
        expect(handleANSIOutput(`${ESC}[5;8;11;53;73mx`)).toStrictEqual([{ text: "x" }]);
    });

    it("swaps the colors once on inverse and back on its end", () => {
        expect(handleANSIOutput(`${ESC}[31;42m${ESC}[7m${ESC}[7mx${ESC}[27m${ESC}[27my`)).toStrictEqual([
            { text: "x", fg: "terminal.ansiGreen", bg: "terminal.ansiRed" },
            { text: "y", fg: "terminal.ansiRed", bg: "terminal.ansiGreen" },
        ]);
    });

    it("takes the 256 colors: the first 16 as the theme's, the cube and the grays as themselves", () => {
        expect(handleANSIOutput(`${ESC}[38;5;1mx`)).toStrictEqual([{ text: "x", fg: "terminal.ansiRed" }]);
        expect(handleANSIOutput(`${ESC}[38;5;9mx`)).toStrictEqual([{ text: "x", fg: "terminal.ansiBrightRed" }]);
        expect(handleANSIOutput(`${ESC}[48;5;2mx`)).toStrictEqual([{ text: "x", bg: "terminal.ansiGreen" }]);
        expect(handleANSIOutput(`${ESC}[48;5;10mx`)).toStrictEqual([{ text: "x", bg: "terminal.ansiBrightGreen" }]);
        expect(handleANSIOutput(`${ESC}[38;5;196mx`)).toStrictEqual([{ text: "x", fg: packRgb(255, 0, 0) }]);
        expect(handleANSIOutput(`${ESC}[48;5;232mx`)).toStrictEqual([{ text: "x", bg: packRgb(0, 0, 0) }]);
        // Out of range: nothing.
        expect(handleANSIOutput(`${ESC}[38;5;256mx`)).toStrictEqual([{ text: "x" }]);
    });

    it("takes truecolor and ignores an incomplete or out of range one", () => {
        expect(handleANSIOutput(`${ESC}[38;2;1;2;3mx`)).toStrictEqual([{ text: "x", fg: packRgb(1, 2, 3) }]);
        expect(handleANSIOutput(`${ESC}[48;2;10;20;30mx`)).toStrictEqual([{ text: "x", bg: packRgb(10, 20, 30) }]);
        expect(handleANSIOutput(`${ESC}[38;2;1;2mx`)).toStrictEqual([{ text: "x" }]);
        expect(handleANSIOutput(`${ESC}[38;2;1;2;300mx`)).toStrictEqual([{ text: "x" }]);
    });

    it("has no cell for the underline color", () => {
        expect(handleANSIOutput(`${ESC}[58;5;1mx${ESC}[58;2;1;2;3my${ESC}[59mz`)).toStrictEqual([
            { text: "x" },
            { text: "y" },
            { text: "z" },
        ]);
    });

    it("hides other known sequences and keeps an unterminated one as text", () => {
        expect(handleANSIOutput(`a${ESC}[2Jb${ESC}[1Ac`)).toStrictEqual([{ text: "a" }, { text: "b" }, { text: "c" }]);
        expect(handleANSIOutput(`a${ESC}[31`)).toStrictEqual([{ text: `a${ESC}[31` }]);
    });

    it("starts a sequence only at Esc and [; a sequence that is not quite SGR styles nothing", () => {
        // Esc without [, and [ without Esc, are text.
        expect(handleANSIOutput(`${ESC}(Bok`)).toStrictEqual([{ text: `${ESC}(Bok` }]);
        expect(handleANSIOutput("a[31mb")).toStrictEqual([{ text: "a[31mb" }]);
        // A private-mode prefix: hidden, but not red.
        expect(handleANSIOutput(`${ESC}[?1;31mx`)).toStrictEqual([{ text: "x" }]);
        // An advanced color of neither the 256 nor the truecolor kind.
        expect(handleANSIOutput(`${ESC}[38;9mx`)).toStrictEqual([{ text: "x" }]);
    });
});

describe("handleANSIOutput at the edges of the color ranges", () => {
    const fg = (code: string) => handleANSIOutput(`${ESC}[${code}mx`)[0].fg;
    const bg = (code: string) => handleANSIOutput(`${ESC}[${code}mx`)[0].bg;

    it("the 16 colors: 30-37 and 90-97 the foreground, 40-47 and 100-107 the background, the rest nothing", () => {
        expect([fg("30"), fg("37"), fg("90"), fg("97")]).toStrictEqual([
            "terminal.ansiBlack",
            "terminal.ansiWhite",
            "terminal.ansiBrightBlack",
            "terminal.ansiBrightWhite",
        ]);
        expect([bg("40"), bg("47"), bg("100"), bg("107")]).toStrictEqual([
            "terminal.ansiBlack",
            "terminal.ansiWhite",
            "terminal.ansiBrightBlack",
            "terminal.ansiBrightWhite",
        ]);
        for (const code of ["29", "89", "98", "50", "99", "108"]) {
            expect(handleANSIOutput(`${ESC}[${code}mx`)).toStrictEqual([{ text: "x" }]);
        }
    });

    it("the default colors reset only their own side", () => {
        expect(handleANSIOutput(`${ESC}[31;42mx${ESC}[39my${ESC}[31;49mz`)).toStrictEqual([
            { text: "x", fg: "terminal.ansiRed", bg: "terminal.ansiGreen" },
            { text: "y", bg: "terminal.ansiGreen" },
            { text: "z", fg: "terminal.ansiRed" },
        ]);
    });

    it("256 colors: 0-15 the theme's, then the cube; nothing without a number", () => {
        expect([fg("38;5;0"), fg("38;5;7"), fg("38;5;8"), fg("38;5;15"), fg("38;5;16")]).toStrictEqual([
            "terminal.ansiBlack",
            "terminal.ansiWhite",
            "terminal.ansiBrightBlack",
            "terminal.ansiBrightWhite",
            packRgb(0, 0, 0),
        ]);
        expect([bg("48;5;0"), bg("48;5;15")]).toStrictEqual(["terminal.ansiBlack", "terminal.ansiBrightWhite"]);
        expect(handleANSIOutput(`${ESC}[38;5mx`)).toStrictEqual([{ text: "x" }]);
    });

    it("truecolor takes 255 in each part and nothing past it or a missing part", () => {
        expect(fg("38;2;255;255;255")).toBe(packRgb(255, 255, 255));
        for (const code of ["38;2;256;0;0", "38;2;0;256;0", "38;2;0;0;256", "38;2;1;2;", "38;2"]) {
            expect(handleANSIOutput(`${ESC}[${code}mx`)).toStrictEqual([{ text: "x" }]);
        }
    });

    it("a code outside the color ranges keeps the colors set", () => {
        // 5 below the foregrounds, 38 between them and the backgrounds, 108 past the bright backgrounds.
        expect(handleANSIOutput(`${ESC}[31;42m${ESC}[5;1;38;108mx`)).toStrictEqual([
            { text: "x", fg: "terminal.ansiRed", bg: "terminal.ansiGreen", style: StyleFlags.Bold },
        ]);
    });

    it("an advanced color of another kind than 5 or 2 is nothing, whatever follows it", () => {
        expect(handleANSIOutput(`${ESC}[38;9;1;2;3mx`)).toStrictEqual([{ text: "x" }]);
    });

    it("a code after the advanced color is not a style of its own", () => {
        // `1` is the 256-color's number here, not bold.
        expect(handleANSIOutput(`${ESC}[38;5;1;1mx`)).toStrictEqual([{ text: "x", fg: "terminal.ansiRed" }]);
    });
});

describe("calcANSI8bitColor", () => {
    it("is the cube and the grays, nothing for the rest", () => {
        expect(calcANSI8bitColor(16)).toBe(packRgb(0, 0, 0));
        expect(calcANSI8bitColor(231)).toBe(packRgb(255, 255, 255));
        expect(calcANSI8bitColor(17)).toBe(packRgb(0, 0, 51));
        expect(calcANSI8bitColor(22)).toBe(packRgb(0, 51, 0));
        expect(calcANSI8bitColor(255)).toBe(packRgb(255, 255, 255));
        expect(calcANSI8bitColor(243)).toBe(packRgb(122, 122, 122));
        expect(calcANSI8bitColor(15)).toBeUndefined();
        expect(calcANSI8bitColor(16.5)).toBeUndefined();
        expect(calcANSI8bitColor(256)).toBeUndefined();
    });
});
