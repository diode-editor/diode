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

/**
 * Маркер «до колонки» — upstream `adjustMarkerBeforeColumn`, но сравнение уже
 * посчитано вызывающим (`cmp` = маркер − колонка): у нас позиции, а не офсеты.
 *
 * `MarkerMoveSemantics` эталона здесь нет: `ForceMove` бывает только с
 * `forceMoveMarkers`, а `ForceStay` (край ровно на начале удаления или на
 * конце общей части) даёт ту же позицию, что и следующая ступень
 * {@link adjustPosition}: смещение 0 от начала правки — это её начало, а конец
 * общей части при удалении длиннее вставки — это конец вставленного.
 */
function markerBefore(cmp: number, stickToPreviousCharacter: boolean): boolean {
    // Stryker disable next-line EqualityOperator: при cmp !== 0 «< 0» и «<= 0» совпадают
    if (cmp !== 0) return cmp < 0;
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
    if (markerBefore(comparePositions(position, edit.start), stickToPreviousCharacter)) {
        return position;
    }
    const afterEnd = comparePositions(position, edit.end);
    // Охрана — только про цену: за концом правки смещение больше удалённого, а
    // значит и общей части, и ступень 2 там всё равно не срабатывает; но мерить
    // его пришлось бы по всем строкам до края.
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
    // Stryker disable next-line EqualityOperator: при start == end обе ветки дают один диапазон
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
            // Stryker disable next-line UpdateOperator: id нужен лишь уникальный, «--» даёт такие же
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
        // Stryker disable next-line ConditionalExpression: короткий путь ради цены — без декораций цикл пуст
        if (this.decorations.size === 0) return;
        const geometry = new EditGeometry(edit, oldLineLength);
        for (const decoration of this.decorations.values()) {
            // Правка целиком ниже декорации её не трогает — частый случай, без аллокаций.
            // Stryker disable next-line ConditionalExpression: короткий путь ради цены — adjustRange вернул бы тот же диапазон
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
