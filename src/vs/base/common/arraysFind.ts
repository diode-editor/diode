/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/arraysFind.ts
// Узкое извлечение — см. шапку src/vs/base/common/arrays.ts.

export function findLastMonotonous<T>(array: readonly T[], predicate: (item: T) => boolean): T | undefined {
    const idx = findLastIdxMonotonous(array, predicate);
    return idx === -1 ? undefined : array[idx];
}

export function findLastIdxMonotonous<T>(
    array: readonly T[],
    predicate: (item: T) => boolean,
    startIdx = 0,
    endIdxEx = array.length,
): number {
    let i = startIdx;
    let j = endIdxEx;
    while (i < j) {
        const k = Math.floor((i + j) / 2);
        if (predicate(array[k])) {
            i = k + 1;
        } else {
            j = k;
        }
    }
    return i - 1;
}

export function findFirstMonotonous<T>(array: readonly T[], predicate: (item: T) => boolean): T | undefined {
    const idx = findFirstIdxMonotonousOrArrLen(array, predicate);
    return idx === array.length ? undefined : array[idx];
}

export function findFirstIdxMonotonousOrArrLen<T>(
    array: readonly T[],
    predicate: (item: T) => boolean,
    startIdx = 0,
    endIdxEx = array.length,
): number {
    let i = startIdx;
    let j = endIdxEx;
    while (i < j) {
        const k = Math.floor((i + j) / 2);
        if (predicate(array[k])) {
            j = k;
        } else {
            i = k + 1;
        }
    }
    return i;
}

/**
 * Use this when
 * * You have a sorted array
 * * You query this array with a monotonous predicate to find the last item that has a certain property.
 * * You query this array multiple times with monotonous predicates that get weaker and weaker.
 */
export class MonotonousArray<T> {
    public static assertInvariants = false;

    // Приватные поля без подчёркиваний — конвенция diode (AGENTS.md); в upstream
    // они `_findLastMonotonousLastIdx`/`_prevFindLastPredicate`/`_array`.
    private findLastMonotonousLastIdx = 0;
    private prevFindLastPredicate: ((item: T) => boolean) | undefined;

    public constructor(private readonly array: readonly T[]) {}

    /**
     * The predicate must be monotonous, i.e. `arr.map(predicate)` must be like `[true, ..., true, false, ..., false]`!
     * For subsequent calls, current predicate must be weaker than (or equal to) the previous predicate, i.e. more entries must be `true`.
     */
    public findLastMonotonous(predicate: (item: T) => boolean): T | undefined {
        if (MonotonousArray.assertInvariants) {
            if (this.prevFindLastPredicate) {
                for (const item of this.array) {
                    if (this.prevFindLastPredicate(item) && !predicate(item)) {
                        throw new Error(
                            "MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.",
                        );
                    }
                }
            }
            this.prevFindLastPredicate = predicate;
        }

        const idx = findLastIdxMonotonous(this.array, predicate, this.findLastMonotonousLastIdx);
        this.findLastMonotonousLastIdx = idx + 1;
        return idx === -1 ? undefined : this.array[idx];
    }
}
