/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/arrays.ts
// Узкое извлечение: только символы, нужные перенесённому коду в
// src/vs/editor/common/{diff,core}. Полный upstream-файл тянет
// cancellation → event → lifecycle → observableInternal (~30 файлов, диффу не
// нужных ни строкой). Логика и имена — дословно upstream (так извлечение можно
// сверить с оригиналом глазами), форматирование наше. Расширять по мере того,
// как перенесённому коду понадобятся новые символы. См. AGENTS.md.

export type CompareResult = number;

// Слияние type + namespace — форма upstream, и менять её нельзя: перенесённый
// код обращается и к типу `CompareResult`, и к константам `CompareResult.*`.
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
            // `last !== undefined` наступает только после итерации, где группа была
            // создана, — то есть здесь currentGroup гарантированно есть.
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
