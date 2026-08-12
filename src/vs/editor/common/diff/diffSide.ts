/**
 * Общий словарь диффа: сторона и текст плашки свёрнутого куска. Вынесен из
 * умершей текстовой синтетики первой смотрелки (`diffViewText`) — живой дифф v2
 * оперирует настоящими документами сторон, но словарь остался общим для
 * раскладки (`diffV2Layout`), intra-line диапазонов и панели.
 */

/** Символ-метка свёрнутого куска в плашке. */
export const ELLIPSIS = "⋯";

/** Сторона диффа. */
export type DiffSide = "original" | "modified";

/** Текст плашки свёрнутого куска. Один на раскладку и на рендер, иначе они разъедутся. */
export function collapsedRowLabel(hiddenLineCount: number): string {
    return `${ELLIPSIS} ${String(hiddenLineCount)} unchanged line${hiddenLineCount === 1 ? "" : "s"}`;
}
