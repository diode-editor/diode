import type { IPosition } from "./iPosition.ts";
import { comparePositions, createPosition, positionsEqual } from "./iPosition.ts";
import type { IRange } from "./iRange.ts";

export interface ISelection {
    readonly anchor: IPosition;
    readonly active: IPosition;
    /** Column remembered for vertical navigation; when absent, `active.character`. */
    readonly idealColumn?: number;
}

export function createSelection(
    anchorLine: number,
    anchorCharacter: number,
    activeLine: number,
    activeCharacter: number,
    idealColumn?: number,
): ISelection {
    return {
        anchor: createPosition(anchorLine, anchorCharacter),
        active: createPosition(activeLine, activeCharacter),
        idealColumn,
    };
}

export function createCursorSelection(line: number, character: number, idealColumn?: number): ISelection {
    const pos = createPosition(line, character);
    return { anchor: pos, active: pos, idealColumn };
}

export function getIdealColumn(selection: ISelection): number {
    return selection.idealColumn ?? selection.active.character;
}

export function withIdealColumn(selection: ISelection, idealColumn: number): ISelection {
    return { anchor: selection.anchor, active: selection.active, idealColumn };
}

export function isSelectionCollapsed(selection: ISelection): boolean {
    return positionsEqual(selection.anchor, selection.active);
}

export function selectionToRange(selection: ISelection): IRange {
    if (comparePositions(selection.anchor, selection.active) <= 0) {
        return { start: selection.anchor, end: selection.active };
    }
    return { start: selection.active, end: selection.anchor };
}
