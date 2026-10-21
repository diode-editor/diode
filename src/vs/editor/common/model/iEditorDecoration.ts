import type { IRange } from "../core/iRange.ts";

// Colors are theme TOKEN NAMES resolved at render time: a theme change recolors without
// the owner recomputing anything (unlike packed-RGB `IGutterChangeDecoration`).

/** Includes the gutter; `endLine` is inclusive. */
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

/** Per-line style: zones with one anchor merge, ghosts and the fold placeholder sit side by side. */
export interface IViewZoneLine {
    readonly text: string;
    /** Defaults to the editor text color. */
    readonly colorToken?: string;
    /** Defaults to the editor background. */
    readonly bgToken?: string;
}

/** `lines` beats `text`/`fillChar` on the lines where it is set. */
export interface IViewZoneDecoration {
    readonly afterLine: number;
    readonly fillChar?: string;
    readonly text?: string;
    /** Defaults to the editor text color. */
    readonly colorToken?: string;
    /** Indexed by the zone's line offset. */
    readonly lines?: readonly IViewZoneLine[];
}

export interface IExternalDecorations {
    readonly lineBackgrounds?: readonly ILineBackgroundDecoration[];
    readonly rangeBackgrounds?: readonly IRangeBackgroundDecoration[];
    readonly gutterMarkers?: readonly IGutterMarkerDecoration[];
    readonly zones?: readonly IViewZoneDecoration[];
}

export const EMPTY_EXTERNAL_DECORATIONS: IExternalDecorations = {};
