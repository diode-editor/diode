import type { IRange } from "../core/iRange.ts";

/** A deleted hunk is an empty range on the line below the deletion. */
export interface IGutterChangeDecoration {
    readonly range: IRange;
    /** Packed 24-bit RGB. */
    readonly color: number;
    readonly dashed?: boolean;
}
