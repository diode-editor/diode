export const ELLIPSIS = "⋯";

export type DiffSide = "original" | "modified";

/** Shared by layout and render, otherwise they drift apart. */
export function collapsedRowLabel(hiddenLineCount: number): string {
    return `${ELLIPSIS} ${String(hiddenLineCount)} unchanged line${hiddenLineCount === 1 ? "" : "s"}`;
}
