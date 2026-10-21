/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/arrays.ts
// Narrow extraction for the vendored editor/common code: the full file pulls in ~30
// base/common files. Logic and names are verbatim upstream so they can be diffed by eye.

export type CompareResult = number;

// Keep the type + namespace merge: vendored code uses both the type and `CompareResult.*`.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CompareResult {
    export function isLessThan(result: CompareResult): boolean {
        return result < 0;
    }

    export function isLessThanOrEqual(result: CompareResult): boolean {
        return result <= 0;
    }

    export function isGreaterThan(result: CompareResult): boolean {
        return result > 0;
    }

    export function isNeitherLessOrGreaterThan(result: CompareResult): boolean {
        return result === 0;
    }

    export const greaterThan = 1;
    export const lessThan = -1;
    export const neitherLessOrGreaterThan = 0;
}

/**
 * A comparator `c` defines a total order `<=` on `T` as following:
 * `c(a, b) <= 0` iff `a` <= `b`.
 * We also have `c(a, b) == 0` iff `c(b, a) == 0`.
 */
export type Comparator<T> = (a: T, b: T) => CompareResult;

export function compareBy<TItem, TCompareBy>(
    selector: (item: TItem) => TCompareBy,
    comparator: Comparator<TCompareBy>,
): Comparator<TItem> {
    return (a, b) => comparator(selector(a), selector(b));
}

/**
 * The natural order on numbers.
 */
export const numberComparator: Comparator<number> = (a, b) => a - b;

export function reverseOrder<TItem>(comparator: Comparator<TItem>): Comparator<TItem> {
    return (a, b) => -comparator(a, b);
}

export function equals<T>(
    one: readonly T[] | undefined,
    other: readonly T[] | undefined,
    itemEquals: (a: T, b: T) => boolean = (a, b) => a === b,
): boolean {
    if (one === other) {
        return true;
    }

    if (!one || !other) {
        return false;
    }

    if (one.length !== other.length) {
        return false;
    }

    for (let i = 0, len = one.length; i < len; i++) {
        if (!itemEquals(one[i], other[i])) {
            return false;
        }
    }

    return true;
}

export function* groupAdjacentBy<T>(
    items: Iterable<T>,
    shouldBeGrouped: (item1: T, item2: T) => boolean,
): Iterable<T[]> {
    let currentGroup: T[] | undefined;
    let last: T | undefined;
    for (const item of items) {
        if (last !== undefined && shouldBeGrouped(last, item)) {
            // `last` is set only after the iteration that created the group.
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            currentGroup!.push(item);
        } else {
            if (currentGroup) {
                yield currentGroup;
            }
            currentGroup = [item];
        }
        last = item;
    }
    if (currentGroup) {
        yield currentGroup;
    }
}

export function forEachAdjacent<T>(arr: T[], f: (item1: T | undefined, item2: T | undefined) => void): void {
    for (let i = 0; i <= arr.length; i++) {
        f(i === 0 ? undefined : arr[i - 1], i === arr.length ? undefined : arr[i]);
    }
}

export function forEachWithNeighbors<T>(
    arr: T[],
    f: (before: T | undefined, element: T, after: T | undefined) => void,
): void {
    for (let i = 0; i < arr.length; i++) {
        f(i === 0 ? undefined : arr[i - 1], arr[i], i + 1 === arr.length ? undefined : arr[i + 1]);
    }
}

export function pushMany<T>(arr: T[], items: readonly T[]): void {
    for (const item of items) {
        arr.push(item);
    }
}

export function sumBy<T>(array: readonly T[], selector: (value: T) => number): number {
    return array.reduce((acc, value) => acc + selector(value), 0);
}

export function arrayInsert<T>(target: T[], insertIndex: number, insertArr: T[]): T[] {
    const before = target.slice(0, insertIndex);
    const after = target.slice(insertIndex);
    return before.concat(insertArr, after);
}
