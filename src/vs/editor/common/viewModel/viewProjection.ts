import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";

import type { IViewZone } from "./iViewZone.ts";

/**
 * The document as rows on screen: a row is a document line (or a wrap fragment of one), or a
 * view zone row. Lines hidden by a collapsed fold have no rows. Same lens as upstream
 * `ViewModelLinesFromProjectedModel` (its hidden areas + line breaks), plus view zones as rows.
 */
export interface IViewProjection {
    readonly rowCount: number;
    /** `>= 0` is a document line, `<= -2` a view zone code ({@link decodeViewZoneAnchor}), `-1` is past the view. */
    docLineOfRow(row: number): number;
    /** Offset of the fragment start within its line; 0 for the first fragment, zones and past the view. */
    startOffsetOfRow(row: number): number;
    /** -1 when the line is hidden by a fold or outside the document. */
    firstRowOfDocLine(line: number): number;
    /** `null` for a document row and past the view. */
    zoneRowAt(row: number): { anchor: number; offset: number } | null;
}

/** Lines `[from, to]` hidden by a collapsed fold (the header `from - 1` stays visible). */
export interface IHiddenRange {
    readonly from: number;
    readonly to: number;
}

/** Wrap points of a line, `null` when it fits. */
export type LineBreaksProvider = (line: number) => readonly number[] | null;

/** `-(afterLine + 3)`: `-1` stays the "not found" sentinel, anchor `-1` encodes as `-2`. */
export function encodeViewZoneRow(afterLine: number): number {
    return -(afterLine + 3);
}

export function decodeViewZoneAnchor(row: number): number {
    // `-3 - row`, not `-(row + 3)`: the latter would give -0 for anchor 0.
    return -3 - row;
}

/** No folds, no wrap, no zones: rows ARE lines, so nothing is stored (200K-line files rebuilt this on every edit). */
export class IdentityProjection implements IViewProjection {
    public constructor(public readonly rowCount: number) {}

    public docLineOfRow(row: number): number {
        return row >= 0 && row < this.rowCount ? row : -1;
    }

    public startOffsetOfRow(): number {
        return 0;
    }

    public firstRowOfDocLine(line: number): number {
        return line >= 0 && line < this.rowCount ? line : -1;
    }

    public zoneRowAt(): null {
        return null;
    }
}

/** Parallel arrays, not per-row objects: the projection is document-sized, a per-row allocation would hurt large files. */
export class ArrayProjection implements IViewProjection {
    private firstRows: Int32Array;

    public constructor(
        /** `>= 0` is a document line number, `< 0` is a view zone code ({@link encodeViewZoneRow}). */
        private readonly rowDocLine: number[],
        private readonly rowStartOffset: number[],
        /** Anchor → first row of the zone: the row encoding doesn't store the offset. `null` without zones. */
        private readonly zoneStartRows: Map<number, number> | null,
        lineCount: number,
    ) {
        this.firstRows = computeFirstRows(rowDocLine, lineCount);
    }

    public get rowCount(): number {
        return this.rowDocLine.length;
    }

    public get hasZones(): boolean {
        return this.zoneStartRows !== null;
    }

    public docLineOfRow(row: number): number {
        return row >= 0 && row < this.rowDocLine.length ? this.rowDocLine[row] : -1;
    }

    public startOffsetOfRow(row: number): number {
        // Stryker disable next-line EqualityOperator: row 0 is a first fragment or a zone row, both have offset 0
        return row >= 0 && row < this.rowStartOffset.length ? this.rowStartOffset[row] : 0;
    }

    public firstRowOfDocLine(line: number): number {
        return line >= 0 && line < this.firstRows.length ? this.firstRows[line] : -1;
    }

    public zoneRowAt(row: number): { anchor: number; offset: number } | null {
        const code = this.docLineOfRow(row);
        if (code >= -1) return null;
        const anchor = decodeViewZoneAnchor(code);
        /* v8 ignore start -- ?? is unreachable: a zone code in the rows always has its start recorded by the build */
        // Stryker disable next-line OptionalChaining: same reason, the map exists whenever a zone code does
        const start = this.zoneStartRows?.get(anchor) ?? 0;
        /* v8 ignore stop */
        return { anchor, offset: row - start };
    }

    /**
     * Upstream `onModelLinesDeleted`/`onModelLinesInserted`: the rows of `[startLine, oldEndLine]`
     * are regenerated for `[startLine, newEndLine]`, the rows below shift by the line delta.
     * `hidden` is the state AFTER the edit and must be a pure shift of the one the rows were built
     * with ({@link shiftHiddenRanges}); zones are not supported — the owner rebuilds instead.
     */
    public applyLineChange(
        change: IDocumentContentChange,
        hidden: readonly IHiddenRange[],
        breaksFor: LineBreaksProvider,
    ): void {
        const lineDelta = change.newEndLine - change.oldEndLine;
        const rows = this.rowDocLine;
        const firstRow = lowerBound(rows, change.startLine);
        const endRow = lowerBound(rows, change.oldEndLine + 1);
        const fresh = generateRows(change.startLine, change.newEndLine, hidden, breaksFor);
        spliceNumbers(rows, firstRow, endRow - firstRow, fresh.docLines);
        spliceNumbers(this.rowStartOffset, firstRow, endRow - firstRow, fresh.startOffsets);
        // Stryker disable next-line ConditionalExpression: a guard for speed only, adding 0 changes nothing
        if (lineDelta !== 0) {
            for (let i = firstRow + fresh.docLines.length; i < rows.length; i++) rows[i] += lineDelta;
        }
        // Recomputed, not patched: one tight loop over a typed array, and no second copy of the shift arithmetic.
        this.firstRows = computeFirstRows(rows, this.firstRows.length + lineDelta);
    }
}

export function buildArrayProjection(
    lineCount: number,
    hidden: readonly IHiddenRange[],
    breaksFor: LineBreaksProvider,
    zones: readonly IViewZone[],
): ArrayProjection {
    const rows = generateRows(0, lineCount - 1, hidden, breaksFor);
    if (zones.length === 0) return new ArrayProjection(rows.docLines, rows.startOffsets, null, lineCount);

    const { rowDocLine, rowStartOffset } = insertViewZones(rows.docLines, rows.startOffsets, zones);
    // Anchors are unique after normalization, so the first row seen for a view zone is its start.
    const zoneStarts = new Map<number, number>();
    // Filter mutants are unkillable: an "anchor" from a document row (decoding a
    // positive number) lands in a foreign key space (<= -3 vs real >= -1)
    // and is never read.
    // Stryker disable EqualityOperator,ConditionalExpression: see above
    for (let i = 0; i < rowDocLine.length; i++) {
        if (rowDocLine[i] < 0) {
            const anchor = decodeViewZoneAnchor(rowDocLine[i]);
            if (!zoneStarts.has(anchor)) zoneStarts.set(anchor, i);
        }
    }
    // Stryker restore EqualityOperator,ConditionalExpression
    return new ArrayProjection(rowDocLine, rowStartOffset, zoneStarts, lineCount);
}

/** Collapsed regions as sorted hidden line ranges: the only part of the fold model the projection depends on. */
export function collectHiddenRanges(regions: readonly IFoldingRegion[]): IHiddenRange[] {
    const hidden: IHiddenRange[] = [];
    for (const region of regions) {
        if (region.isCollapsed) hidden.push({ from: region.startLine + 1, to: region.endLine });
    }
    return hidden.sort((a, b) => a.from - b.from);
}

export function hiddenRangesEqual(a: readonly IHiddenRange[], b: readonly IHiddenRange[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].from !== b[i].from || a[i].to !== b[i].to) return false;
    }
    return true;
}

/**
 * Where a line shift alone would leave the hidden ranges, mirroring
 * `EditorViewState.adjustFoldingRegionsForLineChange`: ranges above the edit stay, ranges below
 * move by the delta, an edit inside a hidden body resizes it. `null` when the edit touches a
 * header or runs past a body: the fold model may drop the region, so the rows must be rebuilt.
 */
export function shiftHiddenRanges(
    ranges: readonly IHiddenRange[],
    change: IDocumentContentChange,
): IHiddenRange[] | null {
    const { startLine, oldEndLine } = change;
    const lineDelta = change.newEndLine - oldEndLine;
    const shifted: IHiddenRange[] = [];
    for (const range of ranges) {
        const header = range.from - 1;
        if (range.to < startLine) {
            shifted.push(range);
        } else if (header > oldEndLine) {
            shifted.push({ from: range.from + lineDelta, to: range.to + lineDelta });
        } else if (startLine > header && oldEndLine <= range.to) {
            shifted.push({ from: range.from, to: range.to + lineDelta });
        } else {
            return null;
        }
    }
    return shifted;
}

/**
 * Two consecutive edits as one: `a` maps the base lines to the current ones, `b` is in current
 * coordinates. The merged change covers everything between them, so it stays in two coordinate
 * systems (base and current) — a per-edit replay would read line breaks and folds of the final
 * text for lines that had different numbers at the time of the edit. A reload (`isFlush`) is
 * just the whole-document change it reports: the replay regenerates every row.
 */
export function mergeLineChanges(a: IDocumentContentChange, b: IDocumentContentChange): IDocumentContentChange {
    const deltaA = a.newEndLine - a.oldEndLine;
    // Stryker disable next-line EqualityOperator: at the boundary both arms give the same old and new end
    const bReachesPastA = b.oldEndLine > a.newEndLine;
    return {
        startLine: Math.min(a.startLine, b.startLine),
        oldEndLine: bReachesPastA ? b.oldEndLine - deltaA : a.oldEndLine,
        newEndLine: bReachesPastA ? b.newEndLine : a.newEndLine + (b.newEndLine - b.oldEndLine),
    };
}

/** Rows of the document lines `[fromLine, toLine]`: one per visible line plus one per wrap point. */
function generateRows(
    fromLine: number,
    toLine: number,
    hidden: readonly IHiddenRange[],
    breaksFor: LineBreaksProvider,
): { docLines: number[]; startOffsets: number[] } {
    const docLines: number[] = [];
    const startOffsets: number[] = [];
    let hiddenIdx = 0;
    for (let line = fromLine; line <= toLine; line++) {
        // Ranges are sorted: the ones already passed never match again.
        while (hiddenIdx < hidden.length && hidden[hiddenIdx].to < line) hiddenIdx++;
        if (hiddenIdx < hidden.length && hidden[hiddenIdx].from <= line) continue;
        docLines.push(line);
        startOffsets.push(0);
        const breaks = breaksFor(line);
        if (breaks !== null) {
            for (const breakOffset of breaks) {
                docLines.push(line);
                startOffsets.push(breakOffset);
            }
        }
    }
    return { docLines, startOffsets };
}

function computeFirstRows(rowDocLine: readonly number[], lineCount: number): Int32Array {
    const firstRows = new Int32Array(lineCount).fill(-1);
    // Stryker disable next-line EqualityOperator: the extra iteration reads undefined and is filtered by the -1 comparison
    for (let i = 0; i < rowDocLine.length; i++) {
        const doc = rowDocLine[i];
        // View zone codes filter themselves out: an Int32Array at a negative index gives undefined, not -1.
        if (firstRows[doc] === -1) firstRows[doc] = i;
    }
    return firstRows;
}

/** First index whose value is `>= target` in a non-decreasing array (no zones: codes would break the order). */
function lowerBound(sorted: readonly number[], target: number): number {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (sorted[mid] < target) low = mid + 1;
        else high = mid;
    }
    return low;
}

/** Spread arguments are capped by the engine (a paste of thousands of wrapped lines would overflow the call), so the items go in chunks. */
export const SPLICE_CHUNK = 1024;

function spliceNumbers(target: number[], start: number, deleteCount: number, items: readonly number[]): void {
    target.splice(start, deleteCount, ...items.slice(0, SPLICE_CHUNK));
    // Stryker disable next-line EqualityOperator: the extra iteration splices an empty slice, a no-op
    for (let i = SPLICE_CHUNK; i < items.length; i += SPLICE_CHUNK) {
        target.splice(start + i, 0, ...items.slice(i, i + SPLICE_CHUNK));
    }
}

/**
 * A view zone goes after the last visible line with `docLine <= afterLine`: an anchor hidden by a
 * fold doesn't lose its zone, since the diff must keep alignment (upstream: `showInHiddenAreas`).
 * Intermediate wrap fragments have `next === visible[i]`, so the zone goes only after the last one.
 */
function insertViewZones(
    visible: readonly number[],
    startOffsets: readonly number[],
    zones: readonly IViewZone[],
): { rowDocLine: number[]; rowStartOffset: number[] } {
    const rowDocLine: number[] = [];
    const rowStartOffset: number[] = [];
    const pushZone = (zone: IViewZone): void => {
        for (let k = 0; k < zone.size; k++) {
            rowDocLine.push(encodeViewZoneRow(zone.afterLine));
            rowStartOffset.push(0);
        }
    };
    let zi = 0;
    /* v8 ignore start -- ?? is unreachable: the visible list is never empty, a fold doesn't hide its own header */
    // Stryker disable next-line LogicalOperator: same reason, and line 0 is always visible so `visible[0]` is 0
    const firstVisible = visible[0] ?? Number.MAX_SAFE_INTEGER;
    /* v8 ignore stop */
    while (zi < zones.length && zones[zi].afterLine < firstVisible) {
        pushZone(zones[zi]);
        zi++;
    }
    for (let i = 0; i < visible.length; i++) {
        rowDocLine.push(visible[i]);
        rowStartOffset.push(startOffsets[i]);
        const next = i + 1 < visible.length ? visible[i + 1] : Number.MAX_SAFE_INTEGER;
        while (zi < zones.length && zones[zi].afterLine >= visible[i] && zones[zi].afterLine < next) {
            pushZone(zones[zi]);
            zi++;
        }
    }
    return { rowDocLine, rowStartOffset };
}
