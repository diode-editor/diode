/**
 * Mirrors upstream `IViewZone`, height in lines. A VIEW property: positions stay document-based,
 * the cursor can't sit on a view zone by construction.
 */
export interface IViewZone {
    /** 0-based; `-1` means before the first line (upstream `afterLineNumber: 0` in 1-based). */
    readonly afterLine: number;
    readonly size: number;
}

/**
 * Who a set of zones belongs to: the owners live side by side and merge by anchor. `view` is the owner of the view
 * (diff), `ghostText` and `codeLens` are the file editor's own.
 */
export type ViewZoneOwner = "view" | "ghostText" | "codeLens";

/** `none` means past the end of the view. */
export type ViewLineKind = "doc" | "zone" | "none";
