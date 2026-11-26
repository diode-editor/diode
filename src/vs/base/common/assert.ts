/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/assert.ts
// Deviation: upstream's `debugger` is removed from `assertFn`, under an inspector it would hang the TUI.
// Deviation: `assertReturnsDefined` is upstream's `types.ts` helper; diode does not port that file.

import { BugIndicatingError, onUnexpectedError } from "./errors.ts";

/**
 * Throws an error with the provided message if the provided value is not `true`.
 */
export function assert(condition: boolean, messageOrError: string | Error = "unexpected state"): asserts condition {
    if (!condition) {
        // if error instance is provided, use it, otherwise create a new one
        const errorToThrow =
            typeof messageOrError === "string"
                ? new BugIndicatingError(`Assertion Failed: ${messageOrError}`)
                : messageOrError;

        throw errorToThrow;
    }
}

/**
 * The value when it is neither `null` nor `undefined`, otherwise a {@link BugIndicatingError}: for a lookup
 * the caller knows to hit (an id only it removes, a map entry it added), where the type cannot say so.
 */
export function assertReturnsDefined<T>(arg: T | null | undefined): NonNullable<T> {
    assert(arg !== null && arg !== undefined, "Argument is `undefined` or `null`.");
    return arg;
}

/**
 * condition must be side-effect free!
 */
export function assertFn(condition: () => boolean): void {
    if (!condition()) {
        // Reevaluate `condition` again to make debugging easier
        condition();
        onUnexpectedError(new BugIndicatingError("Assertion Failed"));
    }
}

export function checkAdjacentItems<T>(items: readonly T[], predicate: (item1: T, item2: T) => boolean): boolean {
    let i = 0;
    while (i < items.length - 1) {
        const a = items[i];
        const b = items[i + 1];
        if (!predicate(a, b)) {
            return false;
        }
        i++;
    }
    return true;
}
