import type { IPosition } from "../core/iPosition.ts";
import { clampPositionToDocument, comparePositions, type IPositionClampTarget } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";

/**
 * Как край декорации ведёт себя при наборе ровно на нём — upstream
 * `TrackedRangeStickiness` (`model.ts`), те же значения.
 */
export enum TrackedRangeStickiness {
    AlwaysGrowsWhenTypingAtEdges = 0,
    NeverGrowsWhenTypingAtEdges = 1,
    GrowsOnlyWhenTypingBefore = 2,
    GrowsOnlyWhenTypingAfter = 3,
}

/** Срез upstream `IModelDecorationOptions`: модели нужно только поведение краёв. */
export interface IModelDecorationOptions {
    /** Кто владеет декорацией — для отладки, как в эталоне. */
    readonly description: string;
    /** По умолчанию — `AlwaysGrowsWhenTypingAtEdges`, как в эталоне. */
    readonly stickiness?: TrackedRangeStickiness;
}

/** Новая декорация для {@link TrackedDecorations.delta} — upstream `IModelDeltaDecoration`. */
export interface IModelDeltaDecoration {
    readonly range: IRange;
    readonly options: IModelDecorationOptions;
}

/** Правка в координатах документа ДО неё — то, что модель применяет за шаг. */
export interface ITrackedEdit {
    readonly range: IRange;
    readonly text: string;
}

/** Длина строки документа ДО правки — мерить смещения внутри заменяемого диапазона. */
export type OldLineLength = (line: number) => number;

/** Семантика сдвига маркера на границе правки — upstream `MarkerMoveSemantics`. */
enum MarkerMoveSemantics {
    MarkerDefined = 0,
    ForceStay = 2,
}

/**
 * Маркер «до колонки» — upstream `adjustMarkerBeforeColumn`, но сравнение уже
 * посчитано вызывающим (`cmp` = маркер − колонка): у нас позиции, а не офсеты.
 */
function markerBefore(cmp: number, stickToPreviousCharacter: boolean, moveSemantics: MarkerMoveSemantics): boolean {
    if (cmp !== 0) return cmp < 0;
    if (moveSemantics === MarkerMoveSemantics.ForceStay) return true;
    return stickToPreviousCharacter;
}

/**
 * Одна правка, разложенная для сдвига позиций: офсеты (в символах, `\n` — один
 * символ) внутри заменяемого диапазона и позиции внутри вставленного текста.
 */
class EditGeometry {
    public readonly start: IPosition;
    public readonly end: IPosition;
    /** Удалено символов. */
    public readonly deleted: number;
    /** Вставлено символов. */
    public readonly inserted: number;
    /** Конец вставленного текста в координатах ПОСЛЕ правки. */
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

    /** Символов от начала правки до `position` (start ≤ position ≤ end) в старом тексте. */
    public offsetInOld(position: IPosition): number {
        if (position.line === this.start.line) return position.character - this.start.character;
        let offset = this.oldLineLength(this.start.line) - this.start.character + 1;
        for (let line = this.start.line + 1; line < position.line; line++) {
            offset += this.oldLineLength(line) + 1;
        }
        return offset + position.character;
    }

    /** Позиция `offset` символов от начала правки внутри вставленного текста (новые координаты). */
    public positionInInserted(offset: number): IPosition {
        let rest = offset;
        for (let i = 0; i < this.insertedLines.length - 1; i++) {
            const length = this.insertedLines[i].length;
            if (rest <= length) return this.atInsertedLine(i, rest);
            rest -= length + 1;
        }
        return this.atInsertedLine(this.insertedLines.length - 1, rest);
    }

    private atInsertedLine(index: number, character: number): IPosition {
        return {
            line: this.start.line + index,
            character: (index === 0 ? this.start.character : 0) + character,
        };
    }
}

/**
 * Куда уезжает край декорации после правки — upstream `nodeAcceptEdit`
 * (`intervalTree.ts`) для одного края, в позициях вместо офсетов
 * (`forceMoveMarkers` у нас не бывает). Порядок проверок тот же:
 * 1. край до начала правки (или на нём и «остаётся») — не двигается;
 * 2. край в той части замены, где символы заменены один к одному, — держит
 *    смещение от начала правки;
 * 3. край внутри остальной замены — прилипает к концу вставленного;
 * 4. край после правки — сдвигается на её разницу.
 */
function adjustPosition(position: IPosition, stickToPreviousCharacter: boolean, edit: EditGeometry): IPosition {
    const firstSemantics = edit.deleted > 0 ? MarkerMoveSemantics.ForceStay : MarkerMoveSemantics.MarkerDefined;
    if (markerBefore(comparePositions(position, edit.start), stickToPreviousCharacter, firstSemantics)) {
        return position;
    }
    const afterEnd = comparePositions(position, edit.end);
    const commonLength = Math.min(edit.deleted, edit.inserted);
    if (commonLength > 0 && afterEnd <= 0) {
        const commonSemantics =
            edit.deleted > edit.inserted ? MarkerMoveSemantics.ForceStay : MarkerMoveSemantics.MarkerDefined;
        const offset = edit.offsetInOld(position);
        if (markerBefore(offset - commonLength, stickToPreviousCharacter, commonSemantics)) {
            return edit.positionInInserted(offset);
        }
    }
    if (markerBefore(afterEnd, stickToPreviousCharacter, MarkerMoveSemantics.MarkerDefined)) {
        return edit.newEnd;
    }
    if (position.line === edit.end.line) {
        return { line: edit.newEnd.line, character: edit.newEnd.character + position.character - edit.end.character };
    }
    return { line: position.line + edit.newEnd.line - edit.end.line, character: position.character };
}

/** Диапазон декорации после правки — см. {@link adjustPosition}. */
function adjustRange(range: IRange, stickiness: TrackedRangeStickiness, edit: EditGeometry): IRange {
    const startStick =
        stickiness === TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges ||
        stickiness === TrackedRangeStickiness.GrowsOnlyWhenTypingBefore;
    const endStick =
        stickiness === TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges ||
        stickiness === TrackedRangeStickiness.GrowsOnlyWhenTypingBefore;
    const start = adjustPosition(range.start, startStick, edit);
    const end = adjustPosition(range.end, endStick, edit);
    return comparePositions(start, end) > 0 ? { start, end: start } : { start, end };
}

interface ITrackedDecoration {
    range: IRange;
    readonly stickiness: TrackedRangeStickiness;
}

/**
 * Декорации модели, которые едут вместе с текстом (upstream — `IntervalTree`
 * в `textModel.ts`). Упрощение: плоский словарь и линейный проход на правку —
 * O(декораций) за правку; дерево с ленивыми дельтами — follow-up
 * (docs/TODO/TrackedDecorations.md), когда декораций станут тысячи.
 */
export class TrackedDecorations {
    private readonly decorations = new Map<string, ITrackedDecoration>();
    private lastId = 0;

    /**
     * Снимает `oldIds` и добавляет `newDecorations` (диапазоны приводятся к
     * документу, как `validateRange` эталона) — upstream `deltaDecorations`.
     * Возвращает id новых в том же порядке.
     */
    public delta(
        oldIds: readonly string[],
        newDecorations: readonly IModelDeltaDecoration[],
        document: IPositionClampTarget,
    ): string[] {
        for (const id of oldIds) this.decorations.delete(id);
        return newDecorations.map((decoration) => {
            const id = String(++this.lastId);
            this.decorations.set(id, {
                range: clampRange(document, decoration.range),
                stickiness: decoration.options.stickiness ?? TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
            });
            return id;
        });
    }

    /** Текущий диапазон декорации; `null` — снята (или id чужой). */
    public getRange(id: string): IRange | null {
        return this.decorations.get(id)?.range ?? null;
    }

    /** Сдвигает все декорации по правке, применяемой к документу ПРЯМО СЕЙЧАС (строки ещё старые). */
    public acceptEdit(edit: ITrackedEdit, oldLineLength: OldLineLength): void {
        if (this.decorations.size === 0) return;
        const geometry = new EditGeometry(edit, oldLineLength);
        for (const decoration of this.decorations.values()) {
            // Правка целиком ниже декорации её не трогает — частый случай, без аллокаций.
            if (comparePositions(decoration.range.end, edit.range.start) < 0) continue;
            decoration.range = adjustRange(decoration.range, decoration.stickiness, geometry);
        }
    }

    /**
     * Содержимое заменено целиком: правок нет, двигать не по чему — декорации
     * остаются на прежних координатах, приведённых к новому тексту.
     */
    public acceptFlush(document: IPositionClampTarget): void {
        for (const decoration of this.decorations.values()) {
            decoration.range = clampRange(document, decoration.range);
        }
    }
}

function clampRange(document: IPositionClampTarget, range: IRange): IRange {
    return { start: clampPositionToDocument(document, range.start), end: clampPositionToDocument(document, range.end) };
}
