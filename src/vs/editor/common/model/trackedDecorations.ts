import type { IPosition } from "../core/iPosition.ts";
import { clampPositionToDocument, comparePositions, type IPositionClampTarget } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";

/** Values match upstream `TrackedRangeStickiness`. */
export enum TrackedRangeStickiness {
    AlwaysGrowsWhenTypingAtEdges = 0,
    NeverGrowsWhenTypingAtEdges = 1,
    GrowsOnlyWhenTypingBefore = 2,
    GrowsOnlyWhenTypingAfter = 3,
}

/** A slice of upstream `IModelDecorationOptions`: the model only needs edge behavior. */
export interface IModelDecorationOptions {
    readonly description: string;
    /** Defaults to `AlwaysGrowsWhenTypingAtEdges`, as upstream. */
    readonly stickiness?: TrackedRangeStickiness;
}

export interface IModelDeltaDecoration {
    readonly range: IRange;
    readonly options: IModelDecorationOptions;
}

/** In document coordinates BEFORE the edit. */
export interface ITrackedEdit {
    readonly range: IRange;
    readonly text: string;
}

/** Document line length BEFORE the edit. */
export type OldLineLength = (line: number) => number;

/**
 * Upstream `adjustMarkerBeforeColumn`, `cmp` = marker - column. No `MarkerMoveSemantics`:
 * `ForceMove` only comes with `forceMoveMarkers`, and `ForceStay` gives the same position
 * as the next stage of {@link adjustPosition}.
 */
function markerBefore(cmp: number, stickToPreviousCharacter: boolean): boolean {
    // Stryker disable next-line EqualityOperator: with cmp !== 0, "< 0" and "<= 0" coincide
    if (cmp !== 0) return cmp < 0;
    return stickToPreviousCharacter;
}

/** Offsets are in characters; `\n` counts as one. */
class EditGeometry {
    public readonly start: IPosition;
    public readonly end: IPosition;
    public readonly deleted: number;
    public readonly inserted: number;
    /** In coordinates AFTER the edit. */
    public readonly newEnd: IPosition;
    private readonly insertedLines: readonly string[];

    public constructor(
        edit: ITrackedEdit,
        private readonly oldLineLength: OldLineLength,
    ) {
        this.start = edit.range.start;
        this.end = edit.range.end;
        this.insertedLines = edit.text.split("\n");
        this.deleted = this.offsetInOld(this.end);
        this.inserted = edit.text.length;
        this.newEnd = this.positionInInserted(this.inserted);
    }

    /** start ≤ position ≤ end, in the old text. */
    public offsetInOld(position: IPosition): number {
        if (position.line === this.start.line) return position.character - this.start.character;
        let offset = this.oldLineLength(this.start.line) - this.start.character + 1;
        for (let line = this.start.line + 1; line < position.line; line++) {
            offset += this.oldLineLength(line) + 1;
        }
        return offset + position.character;
    }

    public positionInInserted(offset: number): IPosition {
        // offset ≤ inserted length, so the loop ends by the last line at the latest.
        let rest = offset;
        let index = 0;
        while (rest > this.insertedLines[index].length) {
            rest -= this.insertedLines[index].length + 1;
            index++;
        }
        return this.atInsertedLine(index, rest);
    }

    private atInsertedLine(index: number, character: number): IPosition {
        return {
            line: this.start.line + index,
            character: (index === 0 ? this.start.character : 0) + character,
        };
    }
}

/**
 * Upstream `nodeAcceptEdit` for one edge, in positions instead of offsets; same stage
 * order: before the edit, stays; in the common part of a replace, keeps its offset; in
 * the rest of the replace, moves to the inserted end; after, shifts by the delta.
 */
function adjustPosition(position: IPosition, stickToPreviousCharacter: boolean, edit: EditGeometry): IPosition {
    if (markerBefore(comparePositions(position, edit.start), stickToPreviousCharacter)) {
        return position;
    }
    const afterEnd = comparePositions(position, edit.end);
    // The guard is only about cost: past the edit end stage 2 never fires anyway, but the
    // offset would be measured across every line up to the edge.
    // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent, see above
    if (afterEnd <= 0) {
        const offset = edit.offsetInOld(position);
        if (markerBefore(offset - Math.min(edit.deleted, edit.inserted), stickToPreviousCharacter)) {
            return edit.positionInInserted(offset);
        }
    }
    if (markerBefore(afterEnd, stickToPreviousCharacter)) {
        return edit.newEnd;
    }
    if (position.line === edit.end.line) {
        return { line: edit.newEnd.line, character: edit.newEnd.character + position.character - edit.end.character };
    }
    return { line: position.line + edit.newEnd.line - edit.end.line, character: position.character };
}

function adjustRange(range: IRange, stickiness: TrackedRangeStickiness, edit: EditGeometry): IRange {
    const startStick =
        stickiness === TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges ||
        stickiness === TrackedRangeStickiness.GrowsOnlyWhenTypingBefore;
    const endStick =
        stickiness === TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges ||
        stickiness === TrackedRangeStickiness.GrowsOnlyWhenTypingBefore;
    const start = adjustPosition(range.start, startStick, edit);
    const end = adjustPosition(range.end, endStick, edit);
    // Stryker disable next-line EqualityOperator: with start == end both branches give the same range
    return comparePositions(start, end) > 0 ? { start, end: start } : { start, end };
}

interface ITrackedDecoration {
    range: IRange;
    readonly stickiness: TrackedRangeStickiness;
}

/**
 * A flat map instead of upstream `IntervalTree`, O(decorations) per edit; a tree once
 * decorations number in the thousands (docs/TODO/TrackedDecorations.md).
 */
export class TrackedDecorations {
    private readonly decorations = new Map<string, ITrackedDecoration>();
    private lastId = 0;

    public delta(
        oldIds: readonly string[],
        newDecorations: readonly IModelDeltaDecoration[],
        document: IPositionClampTarget,
    ): string[] {
        for (const id of oldIds) this.decorations.delete(id);
        return newDecorations.map((decoration) => {
            // Stryker disable next-line UpdateOperator: the id only has to be unique, "--" gives unique ones too
            const id = String(++this.lastId);
            this.decorations.set(id, {
                range: clampRange(document, decoration.range),
                stickiness: decoration.options.stickiness ?? TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
            });
            return id;
        });
    }

    public getRange(id: string): IRange | null {
        return this.decorations.get(id)?.range ?? null;
    }

    /** Call while the document lines are still old. */
    public acceptEdit(edit: ITrackedEdit, oldLineLength: OldLineLength): void {
        // Stryker disable next-line ConditionalExpression: a fast path for cost; with no decorations the loop is empty
        if (this.decorations.size === 0) return;
        const geometry = new EditGeometry(edit, oldLineLength);
        for (const decoration of this.decorations.values()) {
            // Stryker disable next-line ConditionalExpression: a fast path for cost; adjustRange would return the same range
            if (comparePositions(decoration.range.end, edit.range.start) < 0) continue;
            decoration.range = adjustRange(decoration.range, decoration.stickiness, geometry);
        }
    }

    public acceptFlush(document: IPositionClampTarget): void {
        for (const decoration of this.decorations.values()) {
            decoration.range = clampRange(document, decoration.range);
        }
    }
}

function clampRange(document: IPositionClampTarget, range: IRange): IRange {
    return { start: clampPositionToDocument(document, range.start), end: clampPositionToDocument(document, range.end) };
}
