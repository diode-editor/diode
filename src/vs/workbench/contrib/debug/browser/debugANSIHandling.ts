/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugANSIHandling.ts
// The SGR sequences of debug output as styled pieces of text: the 16 colors are the terminal's theme colors
// (`terminal.ansi*`), the 256-color cube and truecolor are the colors themselves. Deviations: pieces, not DOM spans
// (links are found in them by the caller); bold, dim, italic, underline (and double underline), strike-through
// map to the terminal's cell flags; blink, hidden, overline, fonts, super/subscript and the underline color have no
// cell to go to and are dropped; colors are not pushed to a contrast against the background (upstream's theming
// participant).

import { packRgb } from "@tuidom/core/common/colorUtils";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";

import { TERMINAL_ANSI_COLOR_KEYS } from "../../../../platform/theme/common/colors/terminalColors.ts";

/** A run of text in one style. */
export interface IAnsiSpan {
    readonly text: string;
    readonly fg?: StyleColor;
    readonly bg?: StyleColor;
    readonly style?: StyleFlags;
}

type ColorType = "foreground" | "background" | "underline";

/** Upstream `handleANSIOutput`: the text without its escape sequences, in runs of one style. */
export function handleANSIOutput(text: string): IAnsiSpan[] {
    const spans: IAnsiSpan[] = [];
    const textLength = text.length;

    // Upstream's style names as the cell flags they map to; double underline is the underline.
    let styleFlags: StyleFlags = StyleFlags.None;
    let customFgColor: StyleColor | undefined;
    let customBgColor: StyleColor | undefined;
    let colorsInverted = false;
    let currentPos = 0;
    let buffer = "";

    // Stryker disable next-line EqualityOperator: one step past the end reads the empty string, which adds nothing
    while (currentPos < textLength) {
        let sequenceFound = false;

        // Potentially an ANSI escape sequence.
        // See http://ascii-table.com/ansi-escape-sequences.php & https://en.wikipedia.org/wiki/ANSI_escape_code
        if (text.charCodeAt(currentPos) === 27 && text.charAt(currentPos + 1) === "[") {
            const startPos = currentPos;
            currentPos += 2; // Ignore 'Esc[' as it's in every sequence.

            let ansiSequence = "";

            while (currentPos < textLength) {
                const char = text.charAt(currentPos);
                ansiSequence += char;

                currentPos++;

                // Look for a known sequence terminating character.
                if ("ABCDHIJKfhmpsu".includes(char)) {
                    sequenceFound = true;
                    break;
                }
            }

            if (sequenceFound) {
                // Flush buffer with previous styles.
                flush();

                /*
                 * Any SGR sequence: digits and semicolons before its `m` (the sequence ends at its first
                 * terminator, so the `m` is its end). Upstream's expression also turns away some first codes no
                 * terminal knows; their codes do nothing here either. An empty code, or the `m` alone, is NaN,
                 * which no code below takes.
                 */
                if (/^[\d;]*m/u.test(ansiSequence)) {
                    const styleCodes = ansiSequence.split(";").map((code) => parseInt(code, 10));

                    if (styleCodes[0] === 38 || styleCodes[0] === 48 || styleCodes[0] === 58) {
                        // Advanced color code - can't be combined with formatting codes like simple colors can
                        // Ignores invalid colors and additional info beyond what is necessary
                        const colorType =
                            styleCodes[0] === 38 ? "foreground" : styleCodes[0] === 48 ? "background" : "underline";

                        if (styleCodes[1] === 5) {
                            set8BitColor(styleCodes, colorType);
                        } else if (styleCodes[1] === 2) {
                            set24BitColor(styleCodes, colorType);
                        }
                    } else {
                        setBasicFormatters(styleCodes);
                    }
                } else {
                    // Unsupported sequence so simply hide it.
                }
            } else {
                currentPos = startPos;
            }
        }

        if (!sequenceFound) {
            buffer += text.charAt(currentPos);
            currentPos++;
        }
    }

    // Flush remaining text buffer if not empty.
    flush();

    return spans;

    function flush(): void {
        if (buffer === "") return;
        spans.push({
            text: buffer,
            ...(customFgColor === undefined ? {} : { fg: customFgColor }),
            ...(customBgColor === undefined ? {} : { bg: customBgColor }),
            ...(styleFlags === StyleFlags.None ? {} : { style: styleFlags }),
        });
        buffer = "";
    }

    /**
     * Change the foreground or background color by clearing the current color and adding the new one. The underline
     * color has no cell to go to.
     */
    function changeColor(colorType: ColorType, color?: StyleColor): void {
        if (colorType === "foreground") {
            customFgColor = color;
        } else if (colorType === "background") {
            customBgColor = color;
        }
    }

    /** Swap foreground and background colors. Used for color inversion. */
    function reverseForegroundAndBackgroundColors(): void {
        const oldFgColor = customFgColor;
        changeColor("foreground", customBgColor);
        changeColor("background", oldFgColor);
    }

    /**
     * Calculate and set basic ANSI formatting. New colors and backgrounds clear old ones; new formatting does not.
     * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#SGR }
     */
    function setBasicFormatters(styleCodes: number[]): void {
        for (const code of styleCodes) {
            switch (code) {
                case 0: {
                    // reset (everything)
                    styleFlags = StyleFlags.None;
                    customFgColor = undefined;
                    customBgColor = undefined;
                    break;
                }
                case 1:
                    styleFlags |= StyleFlags.Bold;
                    break;
                case 2:
                    styleFlags |= StyleFlags.Dim;
                    break;
                case 3:
                    styleFlags |= StyleFlags.Italic;
                    break;
                case 4:
                    styleFlags |= StyleFlags.Underline;
                    break;
                case 7: {
                    // invert foreground and background
                    if (!colorsInverted) {
                        colorsInverted = true;
                        reverseForegroundAndBackgroundColors();
                    }
                    break;
                }
                case 9:
                    styleFlags |= StyleFlags.Strikethrough;
                    break;
                case 21:
                    styleFlags |= StyleFlags.Underline;
                    break;
                case 22:
                    // normal intensity (bold off and dim off)
                    styleFlags &= ~(StyleFlags.Bold | StyleFlags.Dim);
                    break;
                case 23:
                    // Neither italic or blackletter (font 10)
                    styleFlags &= ~StyleFlags.Italic;
                    break;
                case 24:
                    // not underlined (Neither singly nor doubly underlined)
                    styleFlags &= ~StyleFlags.Underline;
                    break;
                case 27: {
                    // not reversed/inverted
                    if (colorsInverted) {
                        colorsInverted = false;
                        reverseForegroundAndBackgroundColors();
                    }
                    break;
                }
                case 29:
                    // not crossed-out
                    styleFlags &= ~StyleFlags.Strikethrough;
                    break;
                case 39:
                    // default foreground color
                    changeColor("foreground", undefined);
                    break;
                case 49:
                    // default background color
                    changeColor("background", undefined);
                    break;
                default:
                    // Blink, hidden, fonts, overline and super/subscript have no cell flag: dropped.
                    setBasicColor(code);
                    break;
            }
        }
    }

    /**
     * Calculate and set styling for complicated 24-bit ANSI color codes.
     * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#24-bit }
     */
    function set24BitColor(styleCodes: number[], colorType: ColorType): void {
        // The codes are digits: never negative; a missing or empty one is undefined or NaN, which fails.
        const [, , red, green, blue] = styleCodes;
        if (red <= 255 && green <= 255 && blue <= 255) changeColor(colorType, packRgb(red, green, blue));
    }

    /**
     * Calculate and set styling for advanced 8-bit ANSI color codes.
     * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit }
     */
    function set8BitColor(styleCodes: number[], colorType: ColorType): void {
        // Upstream maps an underline color of the 16 to a foreground one; the underline color has no cell here.
        if (colorType === "underline") return;
        let colorNumber = styleCodes[2];
        const color = calcANSI8bitColor(colorNumber);

        if (color !== undefined) {
            changeColor(colorType, color);
        } else {
            // One of the 16, or nothing: past 15 or without a number, the code below is no color code.
            // Need to map to one of the four basic color ranges (30-37, 90-97, 40-47, 100-107)
            colorNumber += 30;
            if (colorNumber >= 38) {
                // Bright colors
                colorNumber += 52;
            }
            if (colorType === "background") {
                colorNumber += 10;
            }
            setBasicColor(colorNumber);
        }
    }

    /**
     * Calculate and set styling for basic bright and dark ANSI color codes: the terminal's theme colors. Codes
     * outside [30-37, 90-97, 40-47, 100-107] do nothing.
     */
    function setBasicColor(styleCode: number): void {
        if (styleCode >= 30 && styleCode <= 37) {
            changeColor("foreground", TERMINAL_ANSI_COLOR_KEYS[styleCode - 30]);
        } else if (styleCode >= 90 && styleCode <= 97) {
            // High-intensity (bright)
            changeColor("foreground", TERMINAL_ANSI_COLOR_KEYS[styleCode - 90 + 8]);
        } else if (styleCode >= 40 && styleCode <= 47) {
            changeColor("background", TERMINAL_ANSI_COLOR_KEYS[styleCode - 40]);
        } else if (styleCode >= 100 && styleCode <= 107) {
            changeColor("background", TERMINAL_ANSI_COLOR_KEYS[styleCode - 100 + 8]);
        }
    }
}

/**
 * Calculate the color from the color set defined in the ANSI 8-bit standard. Standard and high intensity colors
 * are not defined in the standard as specific colors, so these and invalid colors return `undefined`.
 * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit } for info.
 */
export function calcANSI8bitColor(colorNumber: number): number | undefined {
    if (colorNumber % 1 !== 0) {
        // Should be integer
        return undefined;
    }
    if (colorNumber >= 16 && colorNumber <= 231) {
        // Converts to one of 216 RGB colors
        colorNumber -= 16;

        let blue = colorNumber % 6;
        colorNumber = (colorNumber - blue) / 6;
        let green = colorNumber % 6;
        colorNumber = (colorNumber - green) / 6;
        let red = colorNumber;

        // red, green, blue now range on [0, 5], need to map to [0,255]
        const convFactor = 255 / 5;
        blue = Math.round(blue * convFactor);
        green = Math.round(green * convFactor);
        red = Math.round(red * convFactor);

        return packRgb(red, green, blue);
    }
    if (colorNumber >= 232 && colorNumber <= 255) {
        // Converts to a grayscale value
        colorNumber -= 232;
        const colorLevel = Math.round((colorNumber / 23) * 255);
        return packRgb(colorLevel, colorLevel, colorLevel);
    }
    return undefined;
}
