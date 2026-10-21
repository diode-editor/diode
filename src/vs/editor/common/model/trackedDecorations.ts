import type { IPosition } from "../core/iPosition.ts";
import { clampPositionToDocument, comparePositions, type IPositionClampTarget } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";

/** Значения — как у upstream `TrackedRangeStickiness`. */
export enum TrackedRangeStickiness {
    AlwaysGrowsWhenTypingAtEdges = 0,
    NeverGrowsWhenTypingAtEdges = 1,
    GrowsOnlyWhenTypingBefore = 2,
    GrowsOnlyWhenTypingAfter = 3,
}

/** Срез upstream `IModelDecorationOptions`: модели нужно только поведение краёв. */
export interface IModelDecorationOptions {
    readonly description: string;
    /** По умолчанию — `AlwaysGrowsWhenTypingAtEdges`, как в эталоне. */
    readonly stickiness?: TrackedRangeStickiness;
}

export interface IModelDeltaDecoration {
    readonly range: IRange;
    readonly options: IModelDecorationOptions;
}

/** В координатах документа ДО правки. */
export interface ITrackedEdit {
    readonly range: IRange;
    readonly text: string;
}

/** Длина строки документа ДО правки. */
export type OldLineLength = (line: number) => number;

/**
 * Upstream `adjustMarkerBeforeColumn`, `cmp` = маркер − колонка. `MarkerMoveSemantics`
 * не нужен: `ForceMove` — только с `forceMoveMarkers`, а `ForceStay` даёт ту же
 * позицию, что и следующая ступень {@link adjustPosition}.
 */
function markerBefore(cmp: number, stickToPreviousCharacter: boolean): boolean {
    // Stryker disable next-line EqualityOperator: при cmp !== 0 «< 0» и «<= 0» совпадают
    if (cmp !== 0) return cmp < 0;
    return stickToPreviousCharacter;
}

/** Офсеты — в символах, `\n` — один символ. */
class EditGeometry {
    public readonly start: IPosition;
    public readonly end: IPosition;
    public readonly deleted: number;
    public readonly inserted: number;
    /** В координатах ПОСЛЕ правки. */
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

    /** start ≤ position ≤ end, в старом тексте. */
    public offsetInOld(position: IPosition): number {
        if (position.line === this.start.line) return position.character - this.start.character;
        let offset = this.oldLineLength(this.start.line) - this.start.character + 1;
        for (let line = this.start.line + 1; line < position.line; line++) {
            offset += this.oldLineLength(line) + 1;
        }
        return offset + position.character;
    }

    public positionInInserted(offset: number): IPosition {
        // offset ≤ длины вставленного, поэтому цикл кончается не позже последней строки.
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
 * Upstream `nodeAcceptEdit` для одного края, в позициях вместо офсетов; порядок
 * ступеней тот же: до правки — на месте; в общей части замены — держит смещение;
 * в остальной замене — к концу вставленного; после — сдвиг на разницу.
 */
function adjustPosition(position: IPosition, stickToPreviousCharacter: boolean, edit: EditGeometry): IPosition {
    if (markerBefore(comparePositions(position, edit.start), stickToPreviousCharacter)) {
        return position;
    }
    const afterEnd = comparePositions(position, edit.end);
    // Охрана — только про цену: за концом правки ступень 2 всё равно не
    // срабатывает, но смещение мерилось бы по всем строкам до края.
    // Stryker disable next-line ConditionalExpression,EqualityOperator: эквивалентна, см. выше
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
    // Stryker disable next-line EqualityOperator: при start == end обе ветки дают один диапазон
    return comparePositions(start, end) > 0 ? { start, end: start } : { start, end };
}

interface ITrackedDecoration {
    range: IRange;
    readonly stickiness: TrackedRangeStickiness;
}

/**
 * Вместо `IntervalTree` эталона — плоский словарь, O(декораций) за правку; дерево —
 * когда декораций станут тысячи (docs/TODO/TrackedDecorations.md).
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
            // Stryker disable next-line UpdateOperator: id нужен лишь уникальный, «--» даёт такие же
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

    /** Звать, пока строки документа ещё старые. */
    public acceptEdit(edit: ITrackedEdit, oldLineLength: OldLineLength): void {
        // Stryker disable next-line ConditionalExpression: короткий путь ради цены — без декораций цикл пуст
        if (this.decorations.size === 0) return;
        const geometry = new EditGeometry(edit, oldLineLength);
        for (const decoration of this.decorations.values()) {
            // Stryker disable next-line ConditionalExpression: короткий путь ради цены — adjustRange вернул бы тот же диапазон
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
