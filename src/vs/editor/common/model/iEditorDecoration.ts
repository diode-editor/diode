import type { IRange } from "../core/iRange.ts";

// Цвета — ИМЕНА ТОКЕНОВ темы, резолвятся при отрисовке: смена темы перекрашивает
// без пересчёта у владельца (в отличие от packed-RGB `IGutterChangeDecoration`).

/** Включая гуттер, `endLine` включительно. */
export interface ILineBackgroundDecoration {
    readonly startLine: number;
    readonly endLine: number;
    readonly colorToken: string;
}

export interface IRangeBackgroundDecoration {
    readonly range: IRange;
    readonly colorToken: string;
}

export interface IGutterMarkerDecoration {
    readonly line: number;
    readonly char: string;
}

/** Свой стиль у строки: зоны с одним якорем сливаются, призраки и плашка свёртки соседствуют. */
export interface IViewZoneLine {
    readonly text: string;
    /** Без него — цвет текста редактора. */
    readonly colorToken?: string;
    /** Без него — фон редактора. */
    readonly bgToken?: string;
}

/** `lines` побеждает `text`/`fillChar` на строках, где он задан. */
export interface IViewZoneDecoration {
    readonly afterLine: number;
    readonly fillChar?: string;
    readonly text?: string;
    /** Без него — цвет текста редактора. */
    readonly colorToken?: string;
    /** По offset строки зоны. */
    readonly lines?: readonly IViewZoneLine[];
}

export interface IExternalDecorations {
    readonly lineBackgrounds?: readonly ILineBackgroundDecoration[];
    readonly rangeBackgrounds?: readonly IRangeBackgroundDecoration[];
    readonly gutterMarkers?: readonly IGutterMarkerDecoration[];
    readonly zones?: readonly IViewZoneDecoration[];
}

export const EMPTY_EXTERNAL_DECORATIONS: IExternalDecorations = {};
