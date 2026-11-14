/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/hash.ts
// Narrow extraction: the string hash the debug model builds stable scope ids from.

export function numberHash(val: number, initialHashVal: number): number {
    return ((initialHashVal << 5) - initialHashVal + val) | 0; // hashVal * 31 + ch, keep as int32
}

export function stringHash(s: string, hashVal: number): number {
    hashVal = numberHash(149417, hashVal);
    for (let i = 0, length = s.length; i < length; i++) {
        hashVal = numberHash(s.charCodeAt(i), hashVal);
    }
    return hashVal;
}
