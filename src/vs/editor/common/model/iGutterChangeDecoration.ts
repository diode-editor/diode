import type { IRange } from "../core/iRange.ts";

/** Удалённый ханк — пустой диапазон на строке под удалением. */
export interface IGutterChangeDecoration {
    readonly range: IRange;
    /** Packed 24-bit RGB. */
    readonly color: number;
    readonly dashed?: boolean;
}
