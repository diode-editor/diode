/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/assert.ts
// Узкое извлечение — см. шапку src/vs/base/common/arrays.ts.
//
// ОТКЛОНЕНИЕ: из `assertFn` убран оператор `debugger` (upstream ставит его,
// чтобы отладчик вставал на нарушенном инварианте). В нашем рантайме это
// означало бы залипание TUI под инспектором; поведение без отладчика идентично.

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
