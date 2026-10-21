export const ELLIPSIS = "⋯";

export type DiffSide = "original" | "modified";

/** Один на раскладку и на рендер, иначе они разъедутся. */
export function collapsedRowLabel(hiddenLineCount: number): string {
    return `${ELLIPSIS} ${String(hiddenLineCount)} unchanged line${hiddenLineCount === 1 ? "" : "s"}`;
}
