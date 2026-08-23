import type { IPosition } from "./iPosition.ts";
import { comparePositions, createPosition, positionsEqual } from "./iPosition.ts";

/**
 * Represents a range in a text document. start <= end (invariant).
 */
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

/** Точное совпадение обеих границ. */
export function rangesEqual(a: IRange, b: IRange): boolean {
    return positionsEqual(a.start, b.start) && positionsEqual(a.end, b.end);
}

/**
 * Позиция внутри диапазона, границы включительно (как upstream `containsPosition`).
 * Схлопнутый диапазон «содержит» только собственную точку.
 */
export function rangeContainsPosition(range: IRange, position: IPosition): boolean {
    return comparePositions(range.start, position) <= 0 && comparePositions(position, range.end) <= 0;
}
