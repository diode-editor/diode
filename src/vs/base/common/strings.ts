/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/strings.ts
// Узкое извлечение — см. шапку src/vs/base/common/arrays.ts.

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
