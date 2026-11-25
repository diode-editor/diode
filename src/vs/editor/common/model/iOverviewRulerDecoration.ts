import type { IRange } from "../core/iRange.ts";

/**
 * A mark in the scrollbar over the rows of the range (upstream `overviewRulerColor` of a decoration type): the
 * scrollbar only, nothing in the gutter. The color arrives resolved, packed RGBA.
 */
export interface IOverviewRulerDecoration {
    readonly range: IRange;
    readonly color: number;
}
