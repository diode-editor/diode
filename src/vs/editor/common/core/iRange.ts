import type { IPosition } from "./iPosition.ts";
import { comparePositions, createPosition, positionsEqual } from "./iPosition.ts";

/** Invariant: start <= end. */
export interface IRange {
    readonly start: IPosition;
    readonly end: IPosition;
}

export function createRange(startLine: number, startCharacter: number, endLine: number, endCharacter: number): IRange {
    return {
        start: createPosition(startLine, startCharacter),
        end: createPosition(endLine, endCharacter),
    };
}

export function rangesEqual(a: IRange, b: IRange): boolean {
    return positionsEqual(a.start, b.start) && positionsEqual(a.end, b.end);
}

/** Bounds are inclusive, like upstream `containsPosition`. */
export function rangeContainsPosition(range: IRange, position: IPosition): boolean {
    return comparePositions(range.start, position) <= 0 && comparePositions(position, range.end) <= 0;
}
