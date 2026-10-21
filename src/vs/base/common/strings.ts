/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/strings.ts

import { CharCode } from "./charCode.ts";

// Числами, а не членами const enum: иначе no-unsafe-enum-comparison (docs/STYLE.md).
const SPACE: number = CharCode.Space;
const TAB: number = CharCode.Tab;
const UTF8_BOM: number = CharCode.UTF8_BOM;

export function commonPrefixLength(a: string, b: string): number {
    const len = Math.min(a.length, b.length);
    let i: number;

    for (i = 0; i < len; i++) {
        if (a.charCodeAt(i) !== b.charCodeAt(i)) {
            return i;
        }
    }

    return len;
}

export function commonSuffixLength(a: string, b: string): number {
    const len = Math.min(a.length, b.length);
    let i: number;

    const aLastIndex = a.length - 1;
    const bLastIndex = b.length - 1;

    for (i = 0; i < len; i++) {
        if (a.charCodeAt(aLastIndex - i) !== b.charCodeAt(bLastIndex - i)) {
            return i;
        }
    }

    return len;
}

export function splitLines(str: string): string[] {
    return str.split(/\r\n|\r|\n/);
}

/**
 * Returns first index of the string that is not whitespace.
 * If string is empty or contains only whitespaces, returns -1
 */
export function firstNonWhitespaceIndex(str: string): number {
    for (let i = 0, len = str.length; i < len; i++) {
        const chCode = str.charCodeAt(i);
        if (chCode !== SPACE && chCode !== TAB) {
            return i;
        }
    }
    return -1;
}

/**
 * Returns last index of the string that is not whitespace.
 * If string is empty or contains only whitespaces, returns -1
 */
export function lastNonWhitespaceIndex(str: string, startIndex: number = str.length - 1): number {
    for (let i = startIndex; i >= 0; i--) {
        const chCode = str.charCodeAt(i);
        if (chCode !== SPACE && chCode !== TAB) {
            return i;
        }
    }
    return -1;
}

/**
 * See http://en.wikipedia.org/wiki/Surrogate_pair
 */
export function isHighSurrogate(charCode: number): boolean {
    return 0xd800 <= charCode && charCode <= 0xdbff;
}

/**
 * See http://en.wikipedia.org/wiki/Surrogate_pair
 */
export function isLowSurrogate(charCode: number): boolean {
    return 0xdc00 <= charCode && charCode <= 0xdfff;
}

/**
 * See http://en.wikipedia.org/wiki/Surrogate_pair
 */
export function computeCodePoint(highSurrogate: number, lowSurrogate: number): number {
    return ((highSurrogate - 0xd800) << 10) + (lowSurrogate - 0xdc00) + 0x10000;
}

/**
 * get the code point that begins at offset `offset`
 */
export function getNextCodePoint(str: string, len: number, offset: number): number {
    const charCode = str.charCodeAt(offset);
    if (isHighSurrogate(charCode) && offset + 1 < len) {
        const nextCharCode = str.charCodeAt(offset + 1);
        if (isLowSurrogate(nextCharCode)) {
            return computeCodePoint(charCode, nextCharCode);
        }
    }
    return charCode;
}

// Generated using https://github.com/alexdima/unicode-utils/blob/main/rtl-test.js
// Не лениво, как upstream `makeContainsRtl`: литерал регэкспа V8-снапшоту не мешает.
const CONTAINS_RTL =
    /(?:[\u05BE\u05C0\u05C3\u05C6\u05D0-\u05F4\u0608\u060B\u060D\u061B-\u064A\u066D-\u066F\u0671-\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u0710\u0712-\u072F\u074D-\u07A5\u07B1-\u07EA\u07F4\u07F5\u07FA\u07FE-\u0815\u081A\u0824\u0828\u0830-\u0858\u085E-\u088E\u08A0-\u08C9\u200F\uFB1D\uFB1F-\uFB28\uFB2A-\uFD3D\uFD50-\uFDC7\uFDF0-\uFDFC\uFE70-\uFEFC]|\uD802[\uDC00-\uDD1B\uDD20-\uDE00\uDE10-\uDE35\uDE40-\uDEE4\uDEEB-\uDF35\uDF40-\uDFFF]|\uD803[\uDC00-\uDD23\uDE80-\uDEA9\uDEAD-\uDF45\uDF51-\uDF81\uDF86-\uDFF6]|\uD83A[\uDC00-\uDCCF\uDD00-\uDD43\uDD4B-\uDFFF]|\uD83B[\uDC00-\uDEBB])/;

/**
 * Returns true if `str` contains any Unicode character that is classified as "R" or "AL".
 */
export function containsRTL(str: string): boolean {
    return CONTAINS_RTL.test(str);
}

const IS_BASIC_ASCII = /^[\t\n\r\x20-\x7E]*$/;
/**
 * Returns true if `str` contains only basic ASCII characters in the range 32 - 126 (including 32 and 126) or \n, \r, \t
 */
export function isBasicASCII(str: string): boolean {
    return IS_BASIC_ASCII.test(str);
}

export const UNUSUAL_LINE_TERMINATORS = /[\u2028\u2029]/; // LINE SEPARATOR (LS) or PARAGRAPH SEPARATOR (PS)
/**
 * Returns true if `str` contains unusual line terminators, like LS or PS
 */
export function containsUnusualLineTerminators(str: string): boolean {
    return UNUSUAL_LINE_TERMINATORS.test(str);
}

// -- UTF-8 BOM

export const UTF8_BOM_CHARACTER = String.fromCharCode(UTF8_BOM);

export function startsWithUTF8BOM(str: string): boolean {
    // Upstream ещё проверяет `str.length > 0`; на пустой строке `charCodeAt(0)` — NaN.
    return str.charCodeAt(0) === UTF8_BOM;
}
