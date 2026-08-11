import type { IRange } from "../core/iRange.ts";

/**
 * Внешние декорации редактора — их задаёт владелец вью (панель диффа), а не
 * сам редактор. Цвета — ИМЕНА ТОКЕНОВ темы: элемент резолвит их через
 * `styleVar` при отрисовке, поэтому смена темы перекрашивает декорации без
 * пересчёта у владельца (в отличие от `IGutterChangeDecoration`, где цвет
 * packed-RGB и владелец перезаливает сам).
 *
 * Главный потребитель — дифф из двух настоящих редакторов
 * (docs/TODO/DiffEditable.md): фоны added/removed-строк, intra-line спаны,
 * маркеры `-`/`+` в гуттере и заполнение зон-филлеров.
 */

/** Фон целых строк документа (включая гуттер), `endLine` включительно. */
export interface ILineBackgroundDecoration {
    readonly startLine: number;
    readonly endLine: number;
    readonly colorToken: string;
}

/** Фон документного диапазона (intra-line подсветка). */
export interface IRangeBackgroundDecoration {
    readonly range: IRange;
    readonly colorToken: string;
}

/** Одиночный глиф в гуттере у строки (маркеры `-`/`+` диффа). */
export interface IGutterMarkerDecoration {
    readonly line: number;
    readonly char: string;
}

/**
 * Наполнение строк зоны с данным якорем: заполнитель на всю ширину
 * (`fillChar`, филлер ░) и/или текст (плашка «⋯ N unchanged lines»).
 */
export interface IViewZoneDecoration {
    readonly afterLine: number;
    readonly fillChar?: string;
    readonly text?: string;
    /** Токен цвета глифов; без него — цвет текста редактора. */
    readonly colorToken?: string;
}

export interface IExternalDecorations {
    readonly lineBackgrounds?: readonly ILineBackgroundDecoration[];
    readonly rangeBackgrounds?: readonly IRangeBackgroundDecoration[];
    readonly gutterMarkers?: readonly IGutterMarkerDecoration[];
    readonly zones?: readonly IViewZoneDecoration[];
}

export const EMPTY_EXTERNAL_DECORATIONS: IExternalDecorations = {};
