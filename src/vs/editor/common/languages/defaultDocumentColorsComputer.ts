import { assert } from "../../../base/common/assert.ts";
import { HSLA, parseHex } from "../../../base/common/color.ts";
import type { IPosition } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";

import type { IColor, IColorInformation } from "./iColorSource.ts";

/**
 * Port of upstream `defaultDocumentColorsComputer.ts`. Positions are 0-based; the regular expressions and
 * the parsing are verbatim.
 */
/** Upstream's target without `getValue`, which the computer never calls. */
export interface IDocumentColorComputerTarget {
    positionAt(offset: number): IPosition;
    /** `RegExpExecArray`, not `RegExpMatchArray`: a match of `matchAll` always has its index. */
    findMatches(regex: RegExp): RegExpExecArray[];
}

function parseCaptureGroups(captureGroups: IterableIterator<string>): number[] {
    const values = [];
    for (const captureGroup of captureGroups) {
        const parsedNumber = Number(captureGroup);
        // Stryker disable next-line ConditionalExpression,StringLiteral: a group is digits or undefined (NaN), never blank
        if (parsedNumber || (parsedNumber === 0 && captureGroup.replace(/\s/g, "") !== "")) {
            values.push(parsedNumber);
        }
    }
    return values;
}

function toIColor(r: number, g: number, b: number, a: number): IColor {
    return {
        red: r / 255,
        blue: b / 255,
        green: g / 255,
        alpha: a,
    };
}

function findRange(model: IDocumentColorComputerTarget, match: RegExpExecArray): IRange {
    const start = model.positionAt(match.index);
    return { start, end: { line: start.line, character: start.character + match[0].length } };
}

function findHexColorInformation(range: IRange, hexValue: string): IColorInformation {
    const parsedHexColor = parseHex(hexValue);
    // The regular expression only lets 3, 4, 6 or 8 hex digits through.
    assert(parsedHexColor !== null);
    return {
        range: range,
        color: toIColor(parsedHexColor.r, parsedHexColor.g, parsedHexColor.b, parsedHexColor.a),
    };
}

function findRGBColorInformation(
    range: IRange,
    matches: RegExpExecArray[],
    isAlpha: boolean,
): IColorInformation | undefined {
    if (matches.length !== 1) {
        return;
    }
    const match = matches[0];
    const captureGroups = match.values();
    const parsedRegex = parseCaptureGroups(captureGroups);
    return {
        range: range,
        color: toIColor(parsedRegex[0], parsedRegex[1], parsedRegex[2], isAlpha ? parsedRegex[3] : 1),
    };
}

function findHSLColorInformation(
    range: IRange,
    matches: RegExpExecArray[],
    isAlpha: boolean,
): IColorInformation | undefined {
    if (matches.length !== 1) {
        return;
    }
    const match = matches[0];
    const captureGroups = match.values();
    const parsedRegex = parseCaptureGroups(captureGroups);
    const rgba = HSLA.toRGBA(
        new HSLA(parsedRegex[0], parsedRegex[1] / 100, parsedRegex[2] / 100, isAlpha ? parsedRegex[3] : 1),
    );
    return {
        range: range,
        color: toIColor(rgba.r, rgba.g, rgba.b, rgba.a),
    };
}

function findMatches(model: IDocumentColorComputerTarget | string, regex: RegExp): RegExpExecArray[] {
    if (typeof model === "string") {
        return [...model.matchAll(regex)];
    } else {
        return model.findMatches(regex);
    }
}

function computeColors(model: IDocumentColorComputerTarget): IColorInformation[] {
    const result: IColorInformation[] = [];
    // Early validation for RGB and HSL (including CSS Level 4 syntax with / separator)
    const initialValidationRegex =
        /\b(rgb|rgba|hsl|hsla)(\([0-9\s,.%/]*\))|^(#)([A-Fa-f0-9]{3})\b|^(#)([A-Fa-f0-9]{4})\b|^(#)([A-Fa-f0-9]{6})\b|^(#)([A-Fa-f0-9]{8})\b|(?<=['"\s])(#)([A-Fa-f0-9]{3})\b|(?<=['"\s])(#)([A-Fa-f0-9]{4})\b|(?<=['"\s])(#)([A-Fa-f0-9]{6})\b|(?<=['"\s])(#)([A-Fa-f0-9]{8})\b/gm;
    const initialValidationMatches = findMatches(model, initialValidationRegex);

    // Potential colors have been found, validate the parameters
    // Stryker disable next-line ConditionalExpression,EqualityOperator,BlockStatement: the loop below does nothing over no matches
    if (initialValidationMatches.length > 0) {
        // Stryker disable Regex: upstream's verbatim parameter expressions below. `^`/`$` are equivalent (the parameters
        // are always exactly one `(…)`), and so is a mandatory `.0+` after 360 (`36[0]` takes a bare 360); every other
        // alternative is pinned by the parameter grammar test.
        for (const initialMatch of initialValidationMatches) {
            // Groups of the alternatives that did not match are undefined, whatever `RegExpMatchArray` says.
            const initialCaptureGroups = initialMatch.filter(
                (captureGroup: string | undefined) => captureGroup !== undefined,
            );
            const colorScheme = initialCaptureGroups[1];
            const colorParameters = initialCaptureGroups[2];
            let colorInformation;
            if (colorScheme === "rgb") {
                // Supports both comma-separated (rgb(255, 0, 0)) and CSS Level 4 space-separated syntax (rgb(255 0 0))
                const regexParameters =
                    /^\(\s*(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\s*[\s,]\s*(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\s*[\s,]\s*(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\s*\)$/gm;
                colorInformation = findRGBColorInformation(
                    findRange(model, initialMatch),
                    findMatches(colorParameters, regexParameters),
                    false,
                );
            } else if (colorScheme === "rgba") {
                // Supports both comma-separated (rgba(255, 0, 0, 0.5)) and CSS Level 4 syntax (rgba(255 0 0 / 0.5))
                const regexParameters =
                    /^\(\s*(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\s*[\s,]\s*(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\s*[\s,]\s*(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\s*(?:[\s,]|[\s]*\/)\s*(0[.][0-9]+|[.][0-9]+|[01][.]|[01])\s*\)$/gm;
                colorInformation = findRGBColorInformation(
                    findRange(model, initialMatch),
                    findMatches(colorParameters, regexParameters),
                    true,
                );
            } else if (colorScheme === "hsl") {
                const regexParameters =
                    /^\(\s*((?:360(?:\.0+)?|(?:36[0]|3[0-5][0-9]|[12][0-9][0-9]|[1-9]?[0-9])(?:\.\d+)?))\s*[\s,]\s*(100(?:\.0+)?|\d{1,2}[.]\d*|\d{1,2})%\s*[\s,]\s*(100(?:\.0+)?|\d{1,2}[.]\d*|\d{1,2})%\s*\)$/gm;
                colorInformation = findHSLColorInformation(
                    findRange(model, initialMatch),
                    findMatches(colorParameters, regexParameters),
                    false,
                );
            } else if (colorScheme === "hsla") {
                // Supports both comma-separated (hsla(253, 100%, 50%, 0.5)) and CSS Level 4 syntax (hsla(253 100% 50% / 0.5))
                const regexParameters =
                    /^\(\s*((?:360(?:\.0+)?|(?:36[0]|3[0-5][0-9]|[12][0-9][0-9]|[1-9]?[0-9])(?:\.\d+)?))\s*[\s,]\s*(100(?:\.0+)?|\d{1,2}[.]\d*|\d{1,2})%\s*[\s,]\s*(100(?:\.0+)?|\d{1,2}[.]\d*|\d{1,2})%\s*(?:[\s,]|[\s]*\/)\s*(0[.][0-9]+|[.][0-9]+|[01][.]0*|[01])\s*\)$/gm;
                colorInformation = findHSLColorInformation(
                    findRange(model, initialMatch),
                    findMatches(colorParameters, regexParameters),
                    true,
                );
            } else {
                // `#`: the initial expression captures no other scheme.
                colorInformation = findHexColorInformation(
                    findRange(model, initialMatch),
                    colorScheme + colorParameters,
                );
            }
            if (colorInformation) {
                result.push(colorInformation);
            }
        }
        // Stryker restore Regex
    }
    return result;
}

/** All default document colors in the document, in document order. */
export function computeDefaultDocumentColors(model: IDocumentColorComputerTarget): IColorInformation[] {
    return computeColors(model);
}
