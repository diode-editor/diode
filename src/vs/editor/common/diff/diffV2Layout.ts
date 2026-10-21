import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import type {
    IExternalDecorations,
    IRangeBackgroundDecoration,
    IViewZoneDecoration,
    IViewZoneLine,
} from "../model/iEditorDecoration.ts";
import type { IViewZone } from "../viewModel/iViewZone.ts";

import type { DiffInnerRanges } from "./diffInnerRanges.ts";
import type { DiffSide } from "./diffSide.ts";
import { collapsedRowLabel } from "./diffSide.ts";
import type { IUnchangedRegion } from "./diffViewModel.ts";
import type { DetailedLineRangeMapping } from "./rangeMapping.ts";

/**
 * docs/arch/workbench/EditorPart.md, the diff tab section. Invariant (the pane's gate):
 * with the same folding both sides have the same number of view lines; zones make up
 * for the length difference of changed blocks, and placeholders come in pairs.
 */

export const DIFF_FILLER_CHAR = "░";

/** US-11. */
export const IDENTICAL_NOTICE = "The files are identical";

export interface IDiffV2SideLayout {
    readonly zones: readonly IViewZone[];
    readonly foldingRegions: readonly IFoldingRegion[];
    readonly decorations: IExternalDecorations;
}

export interface IDiffV2Layout {
    readonly original: IDiffV2SideLayout;
    readonly modified: IDiffV2SideLayout;
}

export function computeDiffV2Layout(
    changes: readonly DetailedLineRangeMapping[],
    regions: readonly IUnchangedRegion[],
    innerRanges: DiffInnerRanges,
    lineCounts: { readonly original: number; readonly modified: number },
): IDiffV2Layout {
    return {
        original: computeSide("original", changes, regions, innerRanges, lineCounts.original),
        modified: computeSide("modified", changes, regions, innerRanges, lineCounts.modified),
    };
}

function computeSide(
    side: DiffSide,
    changes: readonly DetailedLineRangeMapping[],
    regions: readonly IUnchangedRegion[],
    innerRanges: DiffInnerRanges,
    lineCount: number,
): IDiffV2SideLayout {
    const zones: IViewZone[] = [];
    const zoneDecorations: IViewZoneDecoration[] = [];
    const lineBackgrounds: { startLine: number; endLine: number; colorToken: string }[] = [];
    const gutterMarkers: { line: number; char: string }[] = [];
    const rangeBackgrounds: {
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        colorToken: string;
    }[] = [];

    const lineToken = side === "original" ? "diffEditor.removedLineBackground" : "diffEditor.insertedLineBackground";
    const marker = side === "original" ? "-" : "+";

    for (const change of changes) {
        const own = side === "original" ? change.original : change.modified;
        const other = side === "original" ? change.modified : change.original;
        // 1-based LineRange → 0-based.
        const start = own.startLineNumber - 1;
        const endExclusive = own.endLineNumberExclusive - 1;
        const ownLength = endExclusive - start;
        const otherLength = other.endLineNumberExclusive - other.startLineNumber;

        // On a pure insert/delete (own is empty) the anchor is the line before the change.
        if (otherLength > ownLength) {
            const afterLine = endExclusive - 1;
            zones.push({ afterLine, size: otherLength - ownLength });
            zoneDecorations.push({ afterLine, fillChar: DIFF_FILLER_CHAR, colorToken: "diffEditor.diagonalFill" });
        }

        if (ownLength > 0) {
            lineBackgrounds.push({ startLine: start, endLine: endExclusive - 1, colorToken: lineToken });
            for (let line = start; line < endExclusive; line++) {
                gutterMarkers.push({ line, char: marker });
            }
            for (let line = start; line < endExclusive; line++) {
                for (const span of innerRanges.get(side, line)) {
                    rangeBackgrounds.push({
                        range: { start: { line, character: span.start }, end: { line, character: span.end } },
                        colorToken:
                            side === "original"
                                ? "diffEditor.removedTextBackground"
                                : "diffEditor.insertedTextBackground",
                    });
                }
            }
        }
    }

    if (changes.length === 0) {
        zones.push({ afterLine: -1, size: 1 });
        zoneDecorations.push({
            afterLine: -1,
            text: IDENTICAL_NOTICE,
            colorToken: "diffEditor.unchangedRegionForeground",
        });
    }

    const foldingRegions: IFoldingRegion[] = [];
    for (const region of regions) {
        if (region.hiddenLineCount <= 0) continue;
        const regionStart = side === "original" ? region.originalStartLine : region.modifiedStartLine;
        const firstHidden = regionStart + region.visibleTop;
        const lastHidden = regionStart + region.lineCount - region.visibleBottom - 1;
        // The fold header is the line above the first hidden one, so EXACTLY the whole
        // hidden chunk is hidden. A chunk at the start of the file has no header above it,
        // so the first line stays visible (a deliberate compromise).
        const headerLine = Math.max(0, firstHidden - 1);
        const endLine = Math.min(lastHidden, lineCount - 1);
        if (endLine <= headerLine) continue;
        foldingRegions.push({ startLine: headerLine, endLine, isCollapsed: true });
        // Anchored on a hidden line, the placeholder survives past the header of the collapsed region.
        const placeholderAnchor = Math.max(headerLine, firstHidden);
        zones.push({ afterLine: placeholderAnchor, size: 1 });
        zoneDecorations.push({
            afterLine: placeholderAnchor,
            text: collapsedRowLabel(endLine - headerLine),
            colorToken: "diffEditor.unchangedRegionForeground",
        });
    }

    return {
        zones,
        foldingRegions,
        decorations: {
            lineBackgrounds,
            rangeBackgrounds,
            gutterMarkers,
            zones: zoneDecorations,
        },
    };
}

/**
 * A single modified editor; deleted lines are ghost zones before their hunk (the upstream
 * inline view mechanism). A fold placeholder and a ghost may share an anchor: the pane
 * output joins them with {@link mergeZoneDecorationsByAnchor}, AFTER placeholders are
 * filtered by collapsed state.
 */
export function computeInlineLayout(
    changes: readonly DetailedLineRangeMapping[],
    regions: readonly IUnchangedRegion[],
    innerRanges: DiffInnerRanges,
    lineCount: number,
    originalLines: readonly string[],
): IDiffV2SideLayout {
    const zones: IViewZone[] = [];
    const zoneDecorations: IViewZoneDecoration[] = [];
    const lineBackgrounds: { startLine: number; endLine: number; colorToken: string }[] = [];
    const gutterMarkers: { line: number; char: string }[] = [];
    const rangeBackgrounds: IRangeBackgroundDecoration[] = [];

    // Fold placeholders go FIRST in the decoration list: when a shared anchor is joined,
    // the placeholder must sit ABOVE the ghost (array order = line order).
    const foldingRegions: IFoldingRegion[] = [];
    for (const region of regions) {
        if (region.hiddenLineCount <= 0) continue;
        const firstHidden = region.modifiedStartLine + region.visibleTop;
        const lastHidden = region.modifiedStartLine + region.lineCount - region.visibleBottom - 1;
        const headerLine = Math.max(0, firstHidden - 1);
        const endLine = Math.min(lastHidden, lineCount - 1);
        if (endLine <= headerLine) continue;
        foldingRegions.push({ startLine: headerLine, endLine, isCollapsed: true });
        const placeholderAnchor = Math.max(headerLine, firstHidden);
        zones.push({ afterLine: placeholderAnchor, size: 1 });
        zoneDecorations.push({
            afterLine: placeholderAnchor,
            text: collapsedRowLabel(endLine - headerLine),
            colorToken: "diffEditor.unchangedRegionForeground",
        });
    }

    for (const change of changes) {
        const modStart = change.modified.startLineNumber - 1;
        const modEndExclusive = change.modified.endLineNumberExclusive - 1;
        const origStart = change.original.startLineNumber - 1;
        const origEndExclusive = change.original.endLineNumberExclusive - 1;

        // For a hunk at the start of the file, setViewZones reads `-1` as a zone before the first line.
        if (origEndExclusive > origStart) {
            const afterLine = modStart - 1;
            const lines = originalLines.slice(origStart, origEndExclusive).map((text) => ({
                text,
                bgToken: "diffEditor.removedLineBackground",
            }));
            zones.push({ afterLine, size: lines.length });
            zoneDecorations.push({ afterLine, lines });
        }

        if (modEndExclusive > modStart) {
            lineBackgrounds.push({
                startLine: modStart,
                endLine: modEndExclusive - 1,
                colorToken: "diffEditor.insertedLineBackground",
            });
            for (let line = modStart; line < modEndExclusive; line++) {
                gutterMarkers.push({ line, char: "+" });
                for (const span of innerRanges.get("modified", line)) {
                    rangeBackgrounds.push({
                        range: { start: { line, character: span.start }, end: { line, character: span.end } },
                        colorToken: "diffEditor.insertedTextBackground",
                    });
                }
            }
        }
    }

    if (changes.length === 0) {
        zones.push({ afterLine: -1, size: 1 });
        zoneDecorations.push({
            afterLine: -1,
            text: IDENTICAL_NOTICE,
            colorToken: "diffEditor.unchangedRegionForeground",
        });
    }

    return {
        zones,
        foldingRegions,
        decorations: {
            lineBackgrounds,
            rangeBackgrounds,
            gutterMarkers,
            zones: zoneDecorations,
        },
    };
}

/**
 * `setViewZones` merges zones with a shared anchor, and render looks decorations up in a
 * `Map<anchor, decoration>`: without joining, the second decoration would silently vanish.
 */
export function mergeZoneDecorationsByAnchor(decorations: readonly IViewZoneDecoration[]): IViewZoneDecoration[] {
    const byAnchor = new Map<number, IViewZoneDecoration[]>();
    for (const decoration of decorations) {
        const bucket = byAnchor.get(decoration.afterLine);
        if (bucket === undefined) byAnchor.set(decoration.afterLine, [decoration]);
        else bucket.push(decoration);
    }
    const merged: IViewZoneDecoration[] = [];
    for (const [afterLine, bucket] of byAnchor) {
        if (bucket.length === 1) {
            merged.push(bucket[0]);
            continue;
        }
        const lines: IViewZoneLine[] = [];
        for (const decoration of bucket) {
            if (decoration.lines !== undefined) lines.push(...decoration.lines);
            else if (decoration.text !== undefined) {
                lines.push({
                    text: decoration.text,
                    ...(decoration.colorToken !== undefined ? { colorToken: decoration.colorToken } : {}),
                });
            }
        }
        merged.push({ afterLine, lines });
    }
    return merged;
}
