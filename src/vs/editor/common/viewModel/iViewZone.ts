/**
 * Mirrors upstream `IViewZone`, height in lines. A VIEW property: positions stay document-based,
 * the cursor can't sit on a view zone by construction.
 */
export interface IViewZone {
    /** 0-based; `-1` means before the first line (upstream `afterLineNumber: 0` in 1-based). */
    readonly afterLine: number;
    readonly size: number;
}

/** `none` means past the end of the view. */
export type ViewLineKind = "doc" | "zone" | "none";
