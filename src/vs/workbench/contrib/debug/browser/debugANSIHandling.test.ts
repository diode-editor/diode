import { packRgb } from "@tuidom/core/common/colorUtils";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { describe, expect, it } from "vitest";

import { calcANSI8bitColor, handleANSIOutput } from "./debugANSIHandling.ts";

const ESC = "\u001b";

describe("handleANSIOutput", () => {
    it("keeps plain text as one unstyled run", () => {
        expect(handleANSIOutput("plain")).toEqual([{ text: "plain" }]);
        expect(handleANSIOutput("")).toEqual([]);
    });

    it("paints the 16 colors with the terminal's theme colors, foreground and background", () => {
        expect(handleANSIOutput(`${ESC}[31mred${ESC}[0m done`)).toEqual([
            { text: "red", fg: "terminal.ansiRed" },
            { text: " done" },
        ]);
        expect(handleANSIOutput(`${ESC}[92;104mx`)).toEqual([
            { text: "x", fg: "terminal.ansiBrightGreen", bg: "terminal.ansiBrightBlue" },
        ]);
        expect(handleANSIOutput(`${ESC}[47mx${ESC}[39;49my`)).toEqual([
            { text: "x", bg: "terminal.ansiWhite" },
            { text: "y" },
        ]);
    });

    it("turns the formatting on and off", () => {
        const on = handleANSIOutput(`${ESC}[1;2;3;4;9mx`);
        expect(on).toEqual([
            {
                text: "x",
                style: StyleFlags.Bold | StyleFlags.Dim | StyleFlags.Italic | StyleFlags.Underline | StyleFlags.Strikethrough,
            },
        ]);
        expect(handleANSIOutput(`${ESC}[1;2;3;4;9m${ESC}[22;23;24;29mx`)).toEqual([{ text: "x" }]);
        expect(handleANSIOutput(`${ESC}[21mx${ESC}[4my${ESC}[24mz`)).toEqual([
            { text: "x", style: StyleFlags.Underline },
            { text: "y", style: StyleFlags.Underline },
            { text: "z" },
        ]);
        // A repeated code does not stack.
        expect(handleANSIOutput(`${ESC}[1m${ESC}[1mx${ESC}[0my`)).toEqual([
            { text: "x", style: StyleFlags.Bold },
            { text: "y" },
        ]);
    });

    it("drops what a cell cannot show", () => {
        // blink, hidden, a font, overline, superscript
        expect(handleANSIOutput(`${ESC}[5;8;11;53;73mx`)).toEqual([{ text: "x" }]);
    });

    it("swaps the colors once on inverse and back on its end", () => {
        expect(handleANSIOutput(`${ESC}[31;42m${ESC}[7m${ESC}[7mx${ESC}[27m${ESC}[27my`)).toEqual([
            { text: "x", fg: "terminal.ansiGreen", bg: "terminal.ansiRed" },
            { text: "y", fg: "terminal.ansiRed", bg: "terminal.ansiGreen" },
        ]);
    });

    it("takes the 256 colors: the first 16 as the theme's, the cube and the grays as themselves", () => {
        expect(handleANSIOutput(`${ESC}[38;5;1mx`)).toEqual([{ text: "x", fg: "terminal.ansiRed" }]);
        expect(handleANSIOutput(`${ESC}[38;5;9mx`)).toEqual([{ text: "x", fg: "terminal.ansiBrightRed" }]);
        expect(handleANSIOutput(`${ESC}[48;5;2mx`)).toEqual([{ text: "x", bg: "terminal.ansiGreen" }]);
        expect(handleANSIOutput(`${ESC}[48;5;10mx`)).toEqual([{ text: "x", bg: "terminal.ansiBrightGreen" }]);
        expect(handleANSIOutput(`${ESC}[38;5;196mx`)).toEqual([{ text: "x", fg: packRgb(255, 0, 0) }]);
        expect(handleANSIOutput(`${ESC}[48;5;232mx`)).toEqual([{ text: "x", bg: packRgb(0, 0, 0) }]);
        // Out of range: nothing.
        expect(handleANSIOutput(`${ESC}[38;5;256mx`)).toEqual([{ text: "x" }]);
    });

    it("takes truecolor and ignores an incomplete or out of range one", () => {
        expect(handleANSIOutput(`${ESC}[38;2;1;2;3mx`)).toEqual([{ text: "x", fg: packRgb(1, 2, 3) }]);
        expect(handleANSIOutput(`${ESC}[48;2;10;20;30mx`)).toEqual([{ text: "x", bg: packRgb(10, 20, 30) }]);
        expect(handleANSIOutput(`${ESC}[38;2;1;2mx`)).toEqual([{ text: "x" }]);
        expect(handleANSIOutput(`${ESC}[38;2;1;2;300mx`)).toEqual([{ text: "x" }]);
    });

    it("has no cell for the underline color", () => {
        expect(handleANSIOutput(`${ESC}[58;5;1mx${ESC}[58;2;1;2;3my${ESC}[59mz`)).toEqual([
            { text: "x" },
            { text: "y" },
            { text: "z" },
        ]);
    });

    it("hides other known sequences and keeps an unterminated one as text", () => {
        expect(handleANSIOutput(`a${ESC}[2Jb${ESC}[1Ac`)).toEqual([{ text: "a" }, { text: "b" }, { text: "c" }]);
        expect(handleANSIOutput(`a${ESC}[31`)).toEqual([{ text: `a${ESC}[31` }]);
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
