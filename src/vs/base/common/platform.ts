/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/platform.ts
// Narrow extraction: full upstream detects the OS at module top level, which breaks the V8 snapshot.

import { onUnexpectedError } from "./errors.ts";

/**
 * `setImmediate`, not the `setTimeout` of upstream's Node branch: tokenization yields
 * in ~1 ms slices, and `setTimeout`'s minimum 1 ms of idle would double the time;
 * input between slices is handled just the same, the poll phase runs first.
 */
export function setTimeout0(callback: () => void): void {
    setImmediate(() => {
        // In Node a macrotask exception crashes the process; in upstream's browser it is only logged.
        try {
            callback();
        } catch (e) {
            onUnexpectedError(e);
        }
    });
}
