import { DisplayLine } from "@tuidom/core/common/displayLine";

import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { IMarkerDecoration } from "../../../platform/markers/common/iMarker.ts";
import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import type { IMultiCursorFindSession } from "../../contrib/multicursor/iMultiCursorFindSession.ts";
import type { IPosition } from "../core/iPosition.ts";
import { comparePositions, createPosition, positionsEqual } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import { createRange, rangeContainsPosition } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import { createCursorSelection, createSelection, isSelectionCollapsed, selectionToRange } from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { compareTextEditsInDocumentOrder, createTextEdit } from "../core/iTextEdit.ts";
import { sortAndMergeSelections } from "../core/sortAndMergeSelections.ts";
import { charClass } from "../core/wordClassification.ts";
import { computeNewLinePlan } from "../languages/autoIndent.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";
import { detectIndentation } from "../model/indentationDetector.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";
import type { IUndoElement } from "../model/iUndoElement.ts";
import { TrackedRangeStickiness } from "../model/trackedDecorations.ts";
import type { DocumentTokenStore } from "../tokens/documentTokenStore.ts";
import type { LineTokens } from "../tokens/lineTokens.ts";
import type { ISemanticLineTokens } from "../tokens/semanticTokensLines.ts";
import type { SemanticTokensStore } from "../tokens/semanticTokensStore.ts";

import type { IViewZone, ViewLineKind } from "./iViewZone.ts";
import { LineBreaksCache } from "./lineBreaksCache.ts";
import type { ILineOperationResult, ITextToCopy } from "./lineOperations.ts";
import {
    computeCopyLines,
    computeCutEdits,
    computeDeleteLines,
    computeDuplicateSelection,
    computeMoveLines,
    computeTextToCopy,
} from "./lineOperations.ts";
import { LONG_LINE_TRUNCATION_BADGE_WIDTH, STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";
import type { ICursorStateComputer } from "./trackedSelections.ts";
import { planTrackedSelections, resolveTrackedSelections } from "./trackedSelections.ts";
import type { IHiddenRange, IViewProjection } from "./viewProjection.ts";
import {
    ArrayProjection,
    buildArrayProjection,
    collectHiddenRanges,
    hiddenRangesEqual,
    IdentityProjection,
    mergeLineChanges,
    shiftHiddenRanges,
} from "./viewProjection.ts";

export type WordWrapMode = "off" | "on" | "wordWrapColumn" | "bounded";

/** `editor.tabSize` / `editor.insertSpaces` / `editor.detectIndentation`: a baseline for detection, not an order. */
export interface IIndentDefaults {
    readonly tabSize?: number;
    readonly insertSpaces?: boolean;
    readonly detectIndentation?: boolean;
}

interface IViewMarkerDecoration {
    readonly id: string;
    readonly severity: IMarkerDecoration["severity"];
}

/** Ctrl+End: whatever the last line turns out to be. */
const END_OF_DOCUMENT = Number.MAX_SAFE_INTEGER;

/** See {@link EditorViewState.goToPosition}: the requested position and where the cursor waits for it. */
interface IPendingNavigationTarget {
    readonly line: number;
    readonly character: number;
    readonly parkedAt: IPosition;
}

/**
 * What the cached projection was built from. Wrap width and tab size are snapshots, not version
 * counters: wordWrap/viewportWidth/tabSize have many writers, and "don't forget to bump the
 * version" invites bugs. `wrapWidth === -1` means wrap is off.
 */
interface IProjectionCacheEntry {
    readonly projection: IViewProjection;
    /** {@link EditorViewState.contentRevision}, not `versionId`: growth of a document on disk has no version. */
    readonly docVersion: number;
    readonly foldsVersion: number;
    readonly zonesVersion: number;
    readonly wrapWidth: number;
    readonly tabSize: number;
    /** The collapsed folds the rows were built with: a fold recompute that keeps them is not a rebuild. */
    readonly hidden: readonly IHiddenRange[];
}

export class EditorViewState {
    private scrollLeftValue = 0;
    private scrollTopValue = 0;

    /** Setters fire {@link onDidChangeView}: damage tracking paints only what's marked, a silent scroll would leave the screen stale. */
    public get scrollLeft(): number {
        return this.scrollLeftValue;
    }

    public set scrollLeft(value: number) {
        // The "wrap ⇒ scrollLeft ≡ 0" invariant is held here, not by checks in every consumer.
        const clamped = this.isWordWrapActive ? 0 : value;
        if (this.scrollLeftValue === clamped) return;
        this.scrollLeftValue = clamped;
        this.fireViewChange();
    }

    public get scrollTop(): number {
        return this.scrollTopValue;
    }

    public set scrollTop(value: number) {
        if (this.scrollTopValue === value) return;
        this.scrollTopValue = value;
        this.fireViewChange();
    }

    public viewportWidth = 80;
    public viewportHeight = 24;
    /** v1 simplification: `wordWrapColumn` behaves like `bounded`, see docs/TODO/WordWrap.md. */
    public wordWrap: WordWrapMode = "off";
    public wordWrapColumn = 80;
    public cursorSurroundingLines = 0;
    /**
     * Not a setting but the result of {@link runDetectIndentation}: {@link indentExplicitlySet}
     * → detection from content → {@link configuredTabSize}.
     */
    public tabSize = 4;
    public insertSpaces = false;
    public configuredTabSize = 4;
    public configuredInsertSpaces = false;
    public detectIndentation = true;
    /** Indentation from `editor.options` (e.g. the stock EditorConfig extension) wins over both detection and config. */
    public indentExplicitlySet = false;
    /**
     * Lives here, not on `EditorElement`: all mutations (keyboard, paste, completion,
     * rename/bulkEdit, `editor.applyEdit`) go through this point. Mutators are no-ops returning
     * `undefined`, like upstream `executeEdits` → `false`; cursor, scroll and folding still work.
     */
    public readOnly = false;
    /**
     * The large-file mode (docs/arch/Editor.md), mirrored from the model by the component: the view skips the
     * passes over every line (the width sweep) and paints only what it shows.
     */
    public isTooLargeForTokenization = false;
    private selectionsValue!: ISelection[];
    private readonly onDidChangeCursorPositionEmitter = new Emitter<void>();
    public readonly onDidChangeCursorPosition = this.onDidChangeCursorPositionEmitter.event;
    private readonly onDidChangeViewEmitter = new Emitter<void>();
    public readonly onDidChangeView = this.onDidChangeViewEmitter.event;
    public get searchMatches(): IRange[] {
        return this.searchMatchesValue;
    }

    public set searchMatches(value: IRange[]) {
        this.searchMatchesValue = value;
        this.fireViewChange();
    }

    /** -1 means no active match. */
    public get currentSearchMatchIndex(): number {
        return this.currentSearchMatchIndexValue;
    }

    public set currentSearchMatchIndex(value: number) {
        if (this.currentSearchMatchIndexValue === value) return;
        this.currentSearchMatchIndexValue = value;
        this.fireViewChange();
    }

    private searchMatchesValue: IRange[] = [];
    private currentSearchMatchIndexValue = -1;
    public readonly document: ITextDocument;
    public foldedRegions: IFoldingRegion[] = [];
    private viewZonesValue: readonly IViewZone[] = [];
    /** Render must call `tokenStore.tokenizeViewport(top, bottom)` before reading tokens. */
    public tokenStore: DocumentTokenStore | undefined;
    public semanticTokens: SemanticTokensStore | undefined;

    /**
     * The Ctrl+D session lives here so it dies with the view; the logic is in
     * `editor/contrib/multicursor/`, the import is type-only: no runtime common → contrib dependency.
     */
    public multiCursorSession: IMultiCursorFindSession | null = null;

    private projectionCache: IProjectionCacheEntry | null = null;
    /** The edits since the cached projection, merged into one; replayed in place by {@link buildProjection}. */
    private pendingProjectionChange: IDocumentContentChange | null = null;
    /**
     * Counts every content change the view has seen, edits and growth alike. The document's `versionId` is
     * not enough as a cache key: a document on disk appends lines while its index is built without bumping
     * it (it is not modified), and a projection keyed by version kept the old row count — Ctrl+End moved the
     * cursor past the rows the view knew and the screen stayed at the top.
     */
    private contentRevision = 0;
    private foldsVersion = 0;
    private zonesVersion = 0;
    private lineBreaksCacheValue: LineBreaksCache | null = null;

    /**
     * Own mutators recompute selections and folds exactly; the
     * {@link remapForDocumentChange} remap would shift them a second time.
     */
    private applyingOwnEdits = false;
    /**
     * Selection ends a reload (flush) clamped because they were past the new end. A document on disk is reloaded
     * with its first chunk only (docs/arch/Editor.md): the end moves on as the index grows, and an end clamped to
     * a provisional last line would otherwise be left in the middle of the file. The set holds the position
     * objects themselves: one the user moves is a new object and drops out. Reset by the next flush.
     */
    private endsClampedByFlush = new WeakSet<IPosition>();
    /**
     * A Go to Line or Ctrl+End whose line is not indexed yet (the document on disk grows while its index is
     * built, docs/arch/Editor.md): the cursor is parked on the provisional end and carried on with each growth.
     */
    private pendingTarget: IPendingNavigationTarget | null = null;
    private pendingTargetMovedAt = 0;
    /** How often a cursor parked by {@link pendingTarget} moves on with the growth; tests set 0. */
    public growthFollowIntervalMs = 250;
    private readonly docContentSubscription: IDisposable;
    // Stryker disable next-line ArrayDeclaration: the document doesn't know a junk element without an id, getDecorationRange returns null
    private markerDecorationIds: readonly IViewMarkerDecoration[] = [];

    /** `indent` goes in before the first detection: a view built with its configuration detects once, not twice. */
    public constructor(document: ITextDocument, selections?: ISelection[], indent: IIndentDefaults = {}) {
        this.document = document;
        this.docContentSubscription = document.onDidChangeContent((change) => {
            // Stryker disable next-line UpdateOperator: revisions only need to differ, "--" works too
            this.contentRevision++;
            this.pendingProjectionChange =
                this.pendingProjectionChange === null ? change : mergeLineChanges(this.pendingProjectionChange, change);
            if (!this.applyingOwnEdits) this.remapForDocumentChange(change);
        });
        this.selections = selections && selections.length > 0 ? selections : [createCursorSelection(0, 0)];
        this.applyIndentDefaults(indent);
    }

    /** A missing key keeps the current baseline; a non-positive `tabSize` counts as missing. */
    public applyIndentDefaults(indent: IIndentDefaults): void {
        const tabSize = indent.tabSize ?? 0;
        if (tabSize > 0) this.configuredTabSize = tabSize;
        if (indent.insertSpaces !== undefined) this.configuredInsertSpaces = indent.insertSpaces;
        if (indent.detectIndentation !== undefined) this.detectIndentation = indent.detectIndentation;
        this.runDetectIndentation();
    }

    public dispose(): void {
        this.docContentSubscription.dispose();
        this.setMarkerDecorations([]);
        this.lineBreaksCacheValue?.dispose();
    }

    /** Ranges become document decorations and move with the text (upstream `MarkerDecorations.update`). */
    public setMarkerDecorations(decorations: readonly IMarkerDecoration[]): void {
        const ids = this.document.deltaDecorations(
            this.markerDecorationIds.map((decoration) => decoration.id),
            decorations.map((decoration) => ({
                range: decoration.range,
                options: {
                    // Stryker disable next-line StringLiteral: the description is for debugging only, as in upstream
                    description: "marker-decoration",
                    stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                },
            })),
        );
        this.markerDecorationIds = ids.map((id, i) => ({ id, severity: decorations[i].severity }));
    }

    public getMarkerDecorations(): IMarkerDecoration[] {
        const result: IMarkerDecoration[] = [];
        for (const { id, severity } of this.markerDecorationIds) {
            const range = this.document.getDecorationRange(id);
            // Only the view itself removes its decorations, so null only guards against a foreign id.
            // Stryker disable next-line ConditionalExpression: see above, nobody outside removes its ids
            if (range !== null) result.push({ range, severity });
        }
        return result;
    }

    public get isWordWrapActive(): boolean {
        return this.wordWrap !== "off";
    }

    /** `null` means wrap is off. The scalar doubles as the cache invalidation key; the lower clamp is in {@link computeLineBreakOffsets}. */
    private effectiveWrapWidth(): number | null {
        if (this.wordWrap === "off") return null;
        if (this.wordWrap === "on") return this.viewportWidth;
        return Math.min(this.viewportWidth, this.wordWrapColumn);
    }

    private wrapBreaks(wrapWidth: number): LineBreaksCache {
        // Stryker disable next-line ConditionalExpression: pure memoization, a cache recreated with the same params gives the same result, only slower
        this.lineBreaksCacheValue ??= new LineBreaksCache(this.document, this.tabSize, wrapWidth);
        this.lineBreaksCacheValue.setParams(this.tabSize, wrapWidth);
        return this.lineBreaksCacheValue;
    }

    /** The only legitimate path from mutators to `document.applyEdits`. */
    private applyDocumentEdits(edits: readonly ITextEdit[]): ReturnType<ITextDocument["applyEdits"]> {
        this.applyingOwnEdits = true;
        try {
            return this.document.applyEdits(edits);
        } finally {
            this.applyingOwnEdits = false;
        }
    }

    /**
     * Remap for a foreign edit (another view, undo/redo, synthetic buffer) is line-based:
     * positions inside the changed range clamp to its end, column drift is accepted.
     */
    private remapForDocumentChange(change: IDocumentContentChange): void {
        const lineDelta = change.newEndLine - change.oldEndLine;

        this.adjustFoldingRegionsForLineChange(change.startLine, change.oldEndLine, lineDelta);

        if (this.continuePendingTarget(change)) return;

        if (change.isFlush === true) this.endsClampedByFlush = new WeakSet();
        const followed: IPosition[] = [];
        const remapped = this.selectionsValue.map((sel) => {
            let anchor = this.remapPosition(sel.anchor, change, lineDelta);
            let active = this.remapPosition(sel.active, change, lineDelta);
            if (change.isFlush === true) {
                if (sel.anchor.line > change.newEndLine) this.endsClampedByFlush.add(anchor);
                if (sel.active.line > change.newEndLine) this.endsClampedByFlush.add(active);
            } else {
                anchor = this.followEnd(anchor, change, followed);
                active = this.followEnd(active, change, followed);
            }
            return anchor === sel.anchor && active === sel.active
                ? sel
                : { anchor, active, idealColumn: sel.idealColumn };
        });
        // Only on a real shift: an idle cursor change would poke the status bar and the extension host.
        if (remapped.some((sel, i) => sel !== this.selectionsValue[i])) {
            this.selections = remapped;
        }
        // An end that followed the growing document takes the viewport along, as the reload in memory would have.
        if (followed.length > 0) {
            this.ensureCursorVisible();
            return;
        }

        // Edit above the viewport: keep the same lines on screen. With folds and view zones
        // the logical shift ≠ the visual one, and an exact recompute isn't worth its cost.
        if (
            lineDelta !== 0 &&
            this.scrollTopValue > 0 &&
            !this.foldedRegions.some((region) => region.isCollapsed) &&
            this.viewZonesValue.length === 0 &&
            change.oldEndLine < this.scrollTopValue
        ) {
            this.scrollTop = Math.max(0, this.scrollTopValue + lineDelta);
        }
    }

    /**
     * Growth of a document on disk arrives as a change on its last line. A selection end the reload clamped
     * there moves to the new last line, as the in-memory reload would have put it; any other position is as
     * {@link remapPosition} left it.
     */
    private followEnd(pos: IPosition, change: IDocumentContentChange, followed: IPosition[]): IPosition {
        const line = change.newEndLine;
        // Only a change that starts on the old last line and reaches the new one is the end moving on.
        const endMoved = change.startLine === change.oldEndLine && line === this.document.lineCount - 1;
        if (!endMoved || !this.endsClampedByFlush.has(pos)) return pos;
        const moved = { line, character: Math.min(pos.character, this.document.getLineLength(line)) };
        this.endsClampedByFlush.add(moved);
        followed.push(moved);
        return moved;
    }

    private remapPosition(pos: IPosition, change: IDocumentContentChange, lineDelta: number): IPosition {
        if (pos.line > change.oldEndLine) {
            return lineDelta === 0 ? pos : { line: pos.line + lineDelta, character: pos.character };
        }
        if (pos.line < change.startLine) return pos;
        const line = Math.min(pos.line, change.newEndLine);
        const character = Math.min(pos.character, this.document.getLineLength(line));
        return line === pos.line && character === pos.character ? pos : { line, character };
    }

    /** The {@link STOP_RENDERING_LINE_AFTER} cap keeps an extremely long line from being O(length) on any path. */
    public displayLineFor(lineContent: string): DisplayLine {
        return new DisplayLine(lineContent, this.tabSize, STOP_RENDERING_LINE_AFTER);
    }

    /**
     * Assignment normalizes via {@link sortAndMergeSelections} and fires the event;
     * mutating the array in place does not. Normalization is here, not in the mutators:
     * there are many writers. The primary one is `selections[0]`, the topmost in the document.
     */
    public get selections(): ISelection[] {
        return this.selectionsValue;
    }

    public set selections(value: readonly ISelection[]) {
        this.selectionsValue = sortAndMergeSelections(value);
        this.fireCursorChange();
    }

    private fireCursorChange(): void {
        this.onDidChangeCursorPositionEmitter.fire();
    }

    private fireViewChange(): void {
        this.onDidChangeViewEmitter.fire();
    }

    /** Grows on every fold change, including a region collapsed in place. */
    public get foldStateVersion(): number {
        return this.foldsVersion;
    }

    private bumpFoldsVersion(): void {
        this.foldsVersion++;
        this.fireViewChange();
    }

    /** Fully recomputed on every config change: otherwise turning off `editor.detectIndentation` has nothing to revert to. */
    public runDetectIndentation(): void {
        if (this.indentExplicitlySet) return;
        const defaults = { tabSize: this.configuredTabSize, insertSpaces: this.configuredInsertSpaces };
        const result = this.detectIndentation ? detectIndentation(this.document, defaults) : defaults;
        this.insertSpaces = result.insertSpaces;
        this.tabSize = result.tabSize;
    }

    public get viewZones(): readonly IViewZone[] {
        return this.viewZonesValue;
    }

    /**
     * Normalizes: drops empty view zones, clamps anchors to `[-1, lineCount-1]`, merges equal
     * anchors. The same set is a no-op without an event: the setter is called on every diff recompute.
     */
    public setViewZones(zones: readonly IViewZone[]): void {
        const byAnchor = new Map<number, number>();
        for (const zone of zones) {
            if (zone.size <= 0) continue;
            const anchor = Math.min(Math.max(-1, zone.afterLine), this.document.lineCount - 1);
            byAnchor.set(anchor, (byAnchor.get(anchor) ?? 0) + zone.size);
        }
        const normalized: IViewZone[] = [...byAnchor.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([afterLine, size]) => ({ afterLine, size }));

        const same =
            normalized.length === this.viewZonesValue.length &&
            normalized.every(
                (zone, i) =>
                    zone.afterLine === this.viewZonesValue[i].afterLine && zone.size === this.viewZonesValue[i].size,
            );
        if (same) return;

        this.viewZonesValue = normalized;
        this.zonesVersion++;
        this.fireViewChange();
    }

    public viewLineKind(viewLine: number): ViewLineKind {
        const row = this.buildProjection().docLineOfRow(viewLine);
        if (row === -1) return "none";
        return row >= 0 ? "doc" : "zone";
    }

    public zoneAnchorForViewLine(viewLine: number): number | null {
        return this.buildProjection().zoneRowAt(viewLine)?.anchor ?? null;
    }

    public zoneRowForViewLine(viewLine: number): { anchor: number; offset: number } | null {
        return this.buildProjection().zoneRowAt(viewLine);
    }

    /** For a view zone, its anchor (the visible line above); for a zone before the file start, the first visible line below. */
    public docLineForViewLine(viewLine: number): number {
        const projection = this.buildProjection();
        return projection.docLineOfRow(this.nearestDocRow(projection, viewLine));
    }

    /** The row itself or the closest document row: above first, then below. */
    private nearestDocRow(projection: IViewProjection, viewLine: number): number {
        // Stryker disable next-line ArithmeticOperator: past the view docLineOfRow is -1, so a start past the end still scans down to the last document row
        const clamped = Math.min(Math.max(0, viewLine), projection.rowCount - 1);
        for (let row = clamped; row >= 0; row--) {
            if (projection.docLineOfRow(row) >= 0) return row;
        }
        // Stryker disable next-line ArithmeticOperator,EqualityOperator: the rows up to `clamped` were just seen to be zones, and past the view docLineOfRow is -1: extra iterations change nothing
        for (let row = clamped + 1; row < projection.rowCount; row++) {
            if (projection.docLineOfRow(row) >= 0) return row;
        }
        /* v8 ignore start -- unreachable: a document is never empty, the view has at least one doc line */
        return 0;
        /* v8 ignore stop */
    }

    public setFoldingRegions(regions: IFoldingRegion[]): void {
        this.foldedRegions = regions;
        this.bumpFoldsVersion();
    }

    public toggleFold(line: number): void {
        for (const region of this.foldedRegions) {
            if (region.startLine === line) {
                region.isCollapsed = !region.isCollapsed;
                this.bumpFoldsVersion();
                this.reconcileHiddenCursors();
                return;
            }
        }
    }

    /** "Innermost" is the candidate with the largest `startLine`. */
    private innermostRegionContaining(
        line: number,
        accept: (region: IFoldingRegion) => boolean,
    ): IFoldingRegion | undefined {
        let best: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            const covers = region.startLine <= line && line <= region.endLine && accept(region);
            if (covers && (best === undefined || region.startLine > best.startLine)) {
                best = region;
            }
        }
        return best;
    }

    public foldingRegionContaining(line: number): IFoldingRegion | undefined {
        return this.innermostRegionContaining(line, () => true);
    }

    public foldRegionContaining(line: number): void {
        const target = this.innermostRegionContaining(line, (region) => !region.isCollapsed);
        if (target !== undefined) {
            target.isCollapsed = true;
            this.bumpFoldsVersion();
            this.reconcileHiddenCursors();
        }
    }

    public unfoldRegionContaining(line: number): void {
        const target = this.innermostRegionContaining(line, (region) => region.isCollapsed);
        if (target !== undefined) {
            target.isCollapsed = false;
            this.bumpFoldsVersion();
        }
    }

    public toggleFoldContaining(line: number): void {
        const region = this.foldingRegionContaining(line);
        if (region !== undefined) {
            region.isCollapsed = !region.isCollapsed;
            this.bumpFoldsVersion();
            this.reconcileHiddenCursors();
        }
    }

    public foldAll(): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = true;
        }
        this.bumpFoldsVersion();
        this.reconcileHiddenCursors();
    }

    public unfoldAll(): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = false;
        }
        this.bumpFoldsVersion();
    }

    public foldRecursively(line: number): void {
        this.setCollapsedRecursively(line, true);
    }

    public unfoldRecursively(line: number): void {
        this.setCollapsedRecursively(line, false);
    }

    private setCollapsedRecursively(line: number, collapsed: boolean): void {
        const root = this.foldingRegionContaining(line);
        if (root === undefined) return;
        for (const region of this.foldedRegions) {
            if (region.startLine >= root.startLine && region.endLine <= root.endLine) {
                region.isCollapsed = collapsed;
            }
        }
        this.bumpFoldsVersion();
        if (collapsed) this.reconcileHiddenCursors();
    }

    public foldLevel(level: number): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = this.regionNestingLevel(region) >= level;
        }
        this.bumpFoldsVersion();
        this.reconcileHiddenCursors();
    }

    /** 1-based. */
    private regionNestingLevel(region: IFoldingRegion): number {
        let level = 1;
        for (const other of this.foldedRegions) {
            if (other === region) continue;
            if (other.startLine <= region.startLine && region.endLine <= other.endLine) {
                level++;
            }
        }
        return level;
    }

    public gotoNextFold(line: number): void {
        let target: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.startLine > line && (target === undefined || region.startLine < target.startLine)) {
                target = region;
            }
        }
        if (target !== undefined) this.goToPosition(target.startLine, 0);
    }

    public gotoPreviousFold(line: number): void {
        let target: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.startLine < line && (target === undefined || region.startLine > target.startLine)) {
                target = region;
            }
        }
        if (target !== undefined) this.goToPosition(target.startLine, 0);
    }

    /** The outermost one: its header is always visible. */
    private outermostCollapsedRegionHiding(line: number): IFoldingRegion | undefined {
        let best: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.isCollapsed && region.startLine < line && line <= region.endLine) {
                if (best === undefined || region.startLine < best.startLine) best = region;
            }
        }
        return best;
    }

    /** A cursor hidden by a fold moves to the region header, as in upstream. */
    private reconcileHiddenCursors(): void {
        const previous = this.selections;
        // Compare BEFORE assigning: the setter merges selections, so afterwards the lengths
        // may differ and an index-wise comparison would lie.
        const mapped = previous.map((sel) => {
            if (this.logicalToVisualLine(sel.active.line) >= 0) return sel;
            const region = this.outermostCollapsedRegionHiding(sel.active.line);
            /* v8 ignore start -- defensive: fold ops only hide valid document lines, which are always inside a collapsed region here */
            if (region === undefined) return sel;
            /* v8 ignore stop */
            const char = Math.min(sel.active.character, this.document.getLineLength(region.startLine));
            return createCursorSelection(region.startLine, char);
        });
        if (!mapped.some((sel, i) => sel !== previous[i])) return;
        this.selections = mapped;
        this.ensureCursorVisible();
    }

    public scrollLineUp(): void {
        this.scrollTop = Math.max(0, this.scrollTop - 1);
    }

    public scrollLineDown(): void {
        const maxScrollTop = Math.max(0, this.getViewLineCount() - this.viewportHeight);
        this.scrollTop = Math.min(maxScrollTop, this.scrollTop + 1);
    }

    public getViewLineCount(): number {
        return this.buildProjection().rowCount;
    }

    public getViewLine(visualLineNumber: number): string {
        const logicalLine = this.visualToLogicalLine(visualLineNumber);
        if (logicalLine < 0 || logicalLine >= this.document.lineCount) {
            return "";
        }
        return this.document.getLineContent(logicalLine);
    }

    /** Doesn't tokenize: render must call `tokenStore.tokenizeViewport(...)` first. */
    public getViewLineTokens(visualLineNumber: number): LineTokens | undefined {
        if (!this.tokenStore) return undefined;
        const logicalLine = this.visualToLogicalLine(visualLineNumber);
        if (logicalLine < 0 || logicalLine >= this.document.lineCount) {
            return undefined;
        }
        return this.tokenStore.getLineTokens(logicalLine);
    }

    public getViewLineSemanticTokens(visualLineNumber: number): ISemanticLineTokens | undefined {
        if (!this.semanticTokens) return undefined;
        return this.semanticTokens.getLineTokens(this.visualToLogicalLine(visualLineNumber));
    }

    /** -1 means the line is hidden by a fold. */
    public logicalToVisualLine(logicalLine: number): number {
        return this.buildProjection().firstRowOfDocLine(logicalLine);
    }

    /** -1 both out of bounds and on a view zone row: {@link viewLineKind} tells them apart, {@link docLineForViewLine} gives the nearest line. */
    public visualToLogicalLine(visualLine: number): number {
        const row = this.buildProjection().docLineOfRow(visualLine);
        return row >= 0 ? row : -1;
    }

    /** `[start, end)`; `{0, 0}` for view zones and outside the view. */
    public viewLineRange(viewLine: number): { start: number; end: number } {
        const projection = this.buildProjection();
        const doc = projection.docLineOfRow(viewLine);
        if (doc < 0) return { start: 0, end: 0 };
        const start = projection.startOffsetOfRow(viewLine);
        // A line's fragments are contiguous (a view zone only goes after the last one).
        const end =
            projection.docLineOfRow(viewLine + 1) === doc
                ? projection.startOffsetOfRow(viewLine + 1)
                : this.document.getLineLength(doc);
        return { start, end };
    }

    public viewLineStartColumn(viewLine: number): number {
        const projection = this.buildProjection();
        const start = projection.startOffsetOfRow(viewLine);
        if (!start) return 0;
        const content = this.document.getLineContent(projection.docLineOfRow(viewLine));
        return this.displayLineFor(content).offsetToColumn(start);
    }

    /** An offset on a fragment boundary maps to the NEXT row (no cursor affinity, v1 simplification, see docs/TODO/WordWrap.md). */
    public viewLineForPosition(line: number, character: number): number {
        const projection = this.buildProjection();
        let row = projection.firstRowOfDocLine(line);
        while (projection.docLineOfRow(row + 1) === line && projection.startOffsetOfRow(row + 1) <= character) {
            row++;
        }
        return row;
    }

    public getSelectedText(): string {
        const sel = this.selections[0];
        if (isSelectionCollapsed(sel)) {
            return "";
        }
        return this.document.getTextInRange(selectionToRange(sel));
    }

    /** For multi-cursor Copy/Cut: with only the primary one, Cut would delete more than it copied. */
    public getSelectedTexts(): string[] {
        return this.selections.map((sel) =>
            isSelectionCollapsed(sel) ? "" : this.document.getTextInRange(selectionToRange(sel)),
        );
    }

    public insertText(text: string): IUndoElement | undefined {
        return this.type(text);
    }

    public type(text: string): IUndoElement | undefined {
        return this.typeEach(() => text);
    }

    /** Each cursor gets its own text: Tab pads with spaces to ITS OWN tab stop. */
    private typeEach(textFor: (range: IRange) => string): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const edits = this.buildEditsFromSelections(textFor);
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.selectionsAfterEdits(inverseEdits);
        this.ensureCursorVisible();
        return {
            label: "type",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /** The cursor lands between `text` and `close`; the caller decides whether to close (`planAutoClose`). `close` is single-line. */
    public typeWithAutoClose(text: string, close: string): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const edits = this.buildEditsFromSelections(() => text + close);
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        // Stryker disable next-line CallExpression: pair tokens are single-line, the line count doesn't
        // change, so no fold bounds move; the call keeps the common mutator order
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.selectionsAfterEdits(inverseEdits).map((sel) =>
            createCursorSelection(sel.active.line, sel.active.character - close.length),
        );
        this.ensureCursorVisible();
        return {
            label: "type",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /** The document doesn't change, so no undo step. The caller ensures the precondition "this char is under the cursor". */
    public typeOverClosingChar(): void {
        this.selections = this.selections.map((sel) =>
            createCursorSelection(sel.active.line, sel.active.character + 1),
        );
        this.ensureCursorVisible();
    }

    public surroundSelections(open: string, close: string): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const sorted = this.sortedSelections();

        const edits: ITextEdit[] = [];
        for (const sel of sorted) {
            const range = selectionToRange(sel);
            edits.push(
                createTextEdit(
                    createRange(range.start.line, range.start.character, range.start.line, range.start.character),
                    open,
                ),
            );
            edits.push(
                createTextEdit(
                    createRange(range.end.line, range.end.character, range.end.line, range.end.character),
                    close,
                ),
            );
        }
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        // Stryker disable next-line CallExpression: as in typeWithAutoClose, surrounding with
        // single-line tokens doesn't change the line count, fold bounds have nowhere to move
        this.adjustFoldingRegionsForEdits(edits);

        // Tokens are single-line: drift is column-only, the shift accumulates per line in document order.
        const lineDelta = new Map<number, number>();
        const remapped: ISelection[] = [];
        for (const sel of sorted) {
            const range = selectionToRange(sel);
            const startChar = range.start.character + (lineDelta.get(range.start.line) ?? 0) + open.length;
            const endChar =
                range.end.character +
                (lineDelta.get(range.end.line) ?? 0) +
                (range.end.line === range.start.line ? open.length : 0);
            // Stryker disable next-line EqualityOperator: for a collapsed selection (equality)
            // both branches build the same empty position pair, the direction is indistinguishable
            const ltr = comparePositions(sel.anchor, sel.active) <= 0;
            remapped.push(
                ltr
                    ? createSelection(range.start.line, startChar, range.end.line, endChar)
                    : createSelection(range.end.line, endChar, range.start.line, startChar),
            );
            lineDelta.set(range.start.line, (lineDelta.get(range.start.line) ?? 0) + open.length);
            lineDelta.set(range.end.line, (lineDelta.get(range.end.line) ?? 0) + close.length);
        }
        this.selections = remapped;
        this.ensureCursorVisible();
        return {
            label: "surround",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * Selections afterwards follow upstream `editor.executeEdits`: `computeCursorState` assigns them
     * (inverse edits in `edits` order); without it or on `null` the previous ones follow the
     * edits. No cursor per edit: there are several edits but one cursor.
     */
    public applyEdits(
        edits: readonly ITextEdit[],
        label: string,
        computeCursorState?: ICursorStateComputer,
    ): IUndoElement | undefined {
        if (this.readOnly || edits.length === 0) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        // Document order is the order in which the document returns inverse edits.
        const order = edits.map((_, i) => i).sort((a, b) => compareTextEditsInDocumentOrder(edits[a], edits[b]));
        const sorted = order.map((i) => edits[i]);
        const tracked = planTrackedSelections(this.document, sorted, this.selections);
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        // Stryker disable next-line ArrayDeclaration: order is a permutation of edits indices, every slot is overwritten
        const inverseInInputOrder: ITextEdit[] = [];
        order.forEach((input, k) => (inverseInInputOrder[input] = inverseEdits[k]));
        this.selections =
            computeCursorState?.(inverseInInputOrder) ?? resolveTrackedSelections(tracked, sorted, inverseEdits);
        this.ensureCursorVisible();
        return {
            label,
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    public insertNewLine(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const sorted = this.sortedSelections();
        const plans = sorted.map((sel) => {
            const range = selectionToRange(sel);
            return computeNewLinePlan({
                lineContent: this.document.getLineContent(range.start.line),
                column: range.start.character,
                tabSize: this.tabSize,
                insertSpaces: this.insertSpaces,
            });
        });
        const edits = sorted.map((sel, i) => createTextEdit(selectionToRange(sel), plans[i].editText));
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        // On block expansion the closing bracket takes the last inserted line, so the cursor goes one line up.
        this.selections = this.selectionsAfterEdits(inverseEdits).map((sel, i) =>
            plans[i].blockExpand ? createCursorSelection(sel.active.line - 1, plans[i].cursorColumn) : sel,
        );
        this.ensureCursorVisible();
        return {
            label: "type",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    public deleteLeft(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                const pos = sel.active;
                if (pos.character > 0) {
                    const lineContent = this.document.getLineContent(pos.line);
                    const dl = this.displayLineFor(lineContent);
                    let prevOffset: number;
                    if (pos.character >= lineContent.length) {
                        /* v8 ignore start -- the `: 0` arm is unreachable: this branch needs pos.character > 0 AND >= line length, so the line is non-empty and always has slots */
                        prevOffset = dl.slots.length > 0 ? dl.slots[dl.slots.length - 1].offset : 0;
                        /* v8 ignore stop */
                    } else {
                        const slotIndex = dl.slotIndexAtOffset(pos.character);
                        prevOffset = slotIndex > 0 ? dl.slots[slotIndex - 1].offset : 0;
                    }
                    edits.push(createTextEdit(createRange(pos.line, prevOffset, pos.line, pos.character), ""));
                } else if (pos.line > 0) {
                    const prevLineLen = this.document.getLineLength(pos.line - 1);
                    edits.push(createTextEdit(createRange(pos.line - 1, prevLineLen, pos.line, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        if (edits.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
            this.adjustFoldingRegionsForEdits(edits);
            this.selections = this.selectionsAfterEdits(inverseEdits);
            this.ensureCursorVisible();
            return {
                label: "deleteLeft",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: edits,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    public cursorLeft(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            let newLine = pos.line;
            let newChar: number;

            if (pos.character > 0) {
                const lineContent = this.document.getLineContent(pos.line);
                const dl = this.displayLineFor(lineContent);
                if (pos.character >= lineContent.length) {
                    /* v8 ignore start -- the `: 0` arm is unreachable: this branch needs pos.character > 0 AND >= line length, so the line is non-empty and always has slots */
                    newChar = dl.slots.length > 0 ? dl.slots[dl.slots.length - 1].offset : 0;
                    /* v8 ignore stop */
                } else {
                    const slotIndex = dl.slotIndexAtOffset(pos.character);
                    newChar = slotIndex > 0 ? dl.slots[slotIndex - 1].offset : 0;
                }
            } else if (pos.line > 0) {
                const prevVisible = this.previousVisibleLine(pos.line);
                /* v8 ignore start -- the else is unreachable: line 0 is always visible, so previousVisibleLine never returns -1 for a line>0 cursor */
                if (prevVisible >= 0) {
                    newLine = prevVisible;
                    newChar = this.document.getLineLength(prevVisible);
                } else {
                    return sel;
                }
                /* v8 ignore stop */
            } else {
                return sel;
            }

            const targetDl = this.displayLineFor(this.document.getLineContent(newLine));
            return this.buildSelection(sel, newLine, newChar, targetDl.offsetToColumn(newChar), inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    public cursorRight(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            const lineLen = this.document.getLineLength(pos.line);
            let newLine = pos.line;
            let newChar: number;

            if (pos.character < lineLen) {
                const lineContent = this.document.getLineContent(pos.line);
                const dl = this.displayLineFor(lineContent);
                const slotIndex = dl.slotIndexAtOffset(pos.character);
                if (slotIndex >= 0 && slotIndex < dl.slots.length - 1) {
                    newChar = dl.slots[slotIndex + 1].offset;
                } else {
                    newChar = lineLen;
                }
            } else {
                const nextVisible = this.nextVisibleLine(pos.line);
                if (nextVisible >= 0) {
                    newLine = nextVisible;
                    newChar = 0;
                } else {
                    return sel;
                }
            }

            const targetDl = this.displayLineFor(this.document.getLineContent(newLine));
            return this.buildSelection(sel, newLine, newChar, targetDl.offsetToColumn(newChar), inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /** Keeps idealColumn: vertical navigation preserves it. */
    public cursorUp(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => this.moveVertically(sel, -1, inSelectionMode));
        this.ensureCursorVisible();
    }

    /** Keeps idealColumn: vertical navigation preserves it. */
    public cursorDown(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => this.moveVertically(sel, 1, inSelectionMode));
        this.ensureCursorVisible();
    }

    private moveVertically(sel: ISelection, direction: 1 | -1, inSelectionMode: boolean): ISelection {
        const step = this.stepPositionVertically(sel.active, this.idealColumnOf(sel), direction);
        if (step === null) return sel;
        return this.buildSelection(sel, step.line, step.character, step.idealColumn, inSelectionMode);
    }

    /**
     * With wrap, steps by visual ROWS. The sticky column is kept relative to the fragment start
     * (`idealAbs − startCol`), while the returned `idealColumn` is absolute again: the next step
     * subtracts the start column and gets the same relative one. `null` means the view edge.
     */
    private stepPositionVertically(
        pos: IPosition,
        idealAbs: number,
        direction: 1 | -1,
    ): { line: number; character: number; idealColumn: number } | null {
        const currentRow = this.viewLineForPosition(pos.line, pos.character);
        if (currentRow < 0) {
            // Cursor on a hidden line (before reconcileHiddenCursors): land line by line.
            const fallbackLine = direction === -1 ? this.previousVisibleLine(pos.line) : this.nextVisibleLine(pos.line);
            if (fallbackLine < 0) return null;
            const dl = this.displayLineFor(this.document.getLineContent(fallbackLine));
            return { line: fallbackLine, character: dl.columnToOffset(idealAbs), idealColumn: idealAbs };
        }

        const projection = this.buildProjection();
        let targetRow = currentRow + direction;
        // Zone rows are skipped; past the view docLineOfRow is -1 and the bounds check below answers.
        // Stryker disable next-line EqualityOperator: one step past the end is -1 as well, the bounds check below answers the same
        while (targetRow >= 0 && targetRow < projection.rowCount && projection.docLineOfRow(targetRow) < 0) {
            targetRow += direction;
        }
        if (targetRow < 0 || targetRow >= projection.rowCount) return null;

        const idealInRow = Math.max(0, idealAbs - this.viewLineStartColumn(currentRow));
        return this.landOnRow(targetRow, idealInRow);
    }

    /** On a non-last fragment, clamps to the last grapheme: the boundary offset belongs to the next row. */
    private landOnRow(targetRow: number, idealInRow: number): { line: number; character: number; idealColumn: number } {
        const targetLine = this.buildProjection().docLineOfRow(targetRow);
        const targetStartCol = this.viewLineStartColumn(targetRow);
        const targetDl = this.displayLineFor(this.document.getLineContent(targetLine));
        const range = this.viewLineRange(targetRow);
        const isLastFragment = range.end === this.document.getLineLength(targetLine);
        let landingCol = targetStartCol + idealInRow;
        if (!isLastFragment) {
            landingCol = Math.min(landingCol, targetDl.offsetToColumn(range.end) - 1);
        }
        return {
            line: targetLine,
            character: targetDl.columnToOffset(landingCol),
            idealColumn: targetStartCol + idealInRow,
        };
    }

    public cursorTop(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            return this.buildSelection(sel, 0, 0, 0, inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    public cursorBottom(inSelectionMode = false): void {
        const lastLine = this.document.lineCount - 1;
        const lastChar = this.document.getLineLength(lastLine);
        const dl = this.displayLineFor(this.document.getLineContent(lastLine));
        const idealCol = dl.offsetToColumn(lastChar);
        this.selections = this.selections.map((sel) => {
            return this.buildSelection(sel, lastLine, lastChar, idealCol, inSelectionMode);
        });
        this.reconcileHiddenCursors();
        this.ensureCursorVisible();
        // The end of a document whose index is still being built is provisional: the cursor keeps going there.
        this.pendingTarget = inSelectionMode
            ? null
            : { line: END_OF_DOCUMENT, character: END_OF_DOCUMENT, parkedAt: createPosition(lastLine, lastChar) };
        this.pendingTargetMovedAt = Date.now();
    }

    /** Smart home, as in upstream: indentation ↔ column 0. */
    public cursorHome(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const content = this.document.getLineContent(sel.active.line);
            // On a wrapped continuation row, go to the fragment start; no smart home from a
            // continuation (v1 simplification, docs/TODO/WordWrap.md).
            const row = this.viewLineForPosition(sel.active.line, sel.active.character);
            const rowStart = this.viewLineRange(row).start;
            if (rowStart > 0) {
                const idealCol = this.viewLineStartColumn(row);
                return this.buildSelection(sel, sel.active.line, rowStart, idealCol, inSelectionMode);
            }
            const firstNonWs = firstNonWhitespaceIndex(content);
            const target = sel.active.character === firstNonWs && firstNonWs !== 0 ? 0 : firstNonWs;
            const idealCol = this.displayLineFor(content).offsetToColumn(target);
            return this.buildSelection(sel, sel.active.line, target, idealCol, inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /** Upstream `cursorLineStart` (Mac Ctrl+A): unlike {@link cursorHome}, doesn't stop at the indentation. */
    public cursorLineStart(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const row = this.viewLineForPosition(sel.active.line, sel.active.character);
            const rowStart = this.viewLineRange(row).start;
            return this.buildSelection(sel, sel.active.line, rowStart, this.viewLineStartColumn(row), inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /** idealColumn = MAX_SAFE_INTEGER makes Up/Down stick to the right edge. */
    public cursorEnd(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const lineLen = this.document.getLineLength(sel.active.line);
            // On a non-last fragment, go to its last grapheme: the boundary offset belongs to
            // the next row (no cursor affinity, docs/TODO/WordWrap.md).
            const rowEnd = this.viewLineRange(this.viewLineForPosition(sel.active.line, sel.active.character)).end;
            if (rowEnd !== lineLen) {
                const dl = this.displayLineFor(this.document.getLineContent(sel.active.line));
                const target = dl.columnToOffset(dl.offsetToColumn(rowEnd) - 1);
                return this.buildSelection(sel, sel.active.line, target, Number.MAX_SAFE_INTEGER, inSelectionMode);
            }
            return this.buildSelection(sel, sel.active.line, lineLen, Number.MAX_SAFE_INTEGER, inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    public cursorWordLeft(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            if (pos.character === 0) {
                const prevLine = this.previousVisibleLine(pos.line);
                if (prevLine >= 0) {
                    const lineLen = this.document.getLineLength(prevLine);
                    const dl = this.displayLineFor(this.document.getLineContent(prevLine));
                    return this.buildSelection(sel, prevLine, lineLen, dl.offsetToColumn(lineLen), inSelectionMode);
                }
                return sel;
            }
            const line = this.document.getLineContent(pos.line);
            const newChar = findWordBoundaryLeft(line, pos.character);
            const dl = this.displayLineFor(line);
            return this.buildSelection(sel, pos.line, newChar, dl.offsetToColumn(newChar), inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    public cursorWordRight(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            const lineLen = this.document.getLineLength(pos.line);
            if (pos.character >= lineLen) {
                const nextLine = this.nextVisibleLine(pos.line);
                if (nextLine >= 0) {
                    return this.buildSelection(sel, nextLine, 0, 0, inSelectionMode);
                }
                return sel;
            }
            const line = this.document.getLineContent(pos.line);
            const newChar = findWordBoundaryRight(line, pos.character);
            const dl = this.displayLineFor(line);
            return this.buildSelection(sel, pos.line, newChar, dl.offsetToColumn(newChar), inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    public selectAll(): void {
        const lastLine = this.document.lineCount - 1;
        const lastChar = this.document.getLineLength(lastLine);
        this.selections = [createSelection(0, 0, lastLine, lastChar)];
    }

    public insertCursorAbove(): void {
        this.insertCursorVertically(-1);
    }

    public insertCursorBelow(): void {
        this.insertCursorVertically(1);
    }

    /** The primary (topmost) one survives: the terminal's hardware cursor follows it. */
    public removeSecondaryCursors(): void {
        // An idle assignment would wake the status bar, history and extension host for nothing.
        if (this.selections.length <= 1) return;
        this.selections = [this.selections[0]];
        this.ensureCursorVisible();
    }

    /** Never removes the last cursor: an editor always has one. */
    public toggleCursorAt(line: number, character: number): void {
        const position = createPosition(line, character);
        const covering = this.selections.findIndex((sel) => rangeContainsPosition(selectionToRange(sel), position));
        if (covering >= 0) {
            if (this.selections.length === 1) return;
            this.selections = this.selections.filter((_, i) => i !== covering);
            return;
        }
        const added = createCursorSelection(line, character);
        this.selections = [...this.selections, added];
        this.revealSelection(added);
    }

    /**
     * Repeated presses grow the stack for free: copies of inner cursors collapse via the
     * setter's merge, just as upstream `addCursorUp` relies on `normalize()`.
     */
    private insertCursorVertically(direction: 1 | -1): void {
        const added: ISelection[] = [];
        for (const sel of this.selections) {
            const translated = this.translateSelectionToAdjacentLine(sel, direction);
            if (translated !== null) added.push(translated);
        }
        if (added.length === 0) return;

        this.selections = [...this.selections, ...added];
        this.revealSelection(direction === -1 ? this.selections[0] : this.selections[this.selections.length - 1]);
    }

    /** `anchor` moves by its own display column, not `idealColumn`: otherwise tabs would skew the selection. */
    private translateSelectionToAdjacentLine(selection: ISelection, direction: 1 | -1): ISelection | null {
        const idealColumn = this.idealColumnOf(selection);
        const activeStep = this.stepPositionVertically(selection.active, idealColumn, direction);
        if (activeStep === null) return null;

        if (isSelectionCollapsed(selection)) {
            return createCursorSelection(activeStep.line, activeStep.character, activeStep.idealColumn);
        }

        const anchorContent = this.document.getLineContent(selection.anchor.line);
        const anchorColumn = this.displayLineFor(anchorContent).offsetToColumn(selection.anchor.character);
        const anchorStep = this.stepPositionVertically(selection.anchor, anchorColumn, direction);
        // The anchor hit the edge but active didn't: the copy would land inside the original
        // selection, the merge would eat it, and the cursor change event would fire idle.
        if (anchorStep === null) return null;

        return createSelection(
            anchorStep.line,
            anchorStep.character,
            activeStep.line,
            activeStep.character,
            activeStep.idealColumn,
        );
    }

    /** Without `idealColumn`, the column accounts for tabs and wide chars, unlike the per-char fallback of `getIdealColumn`. */
    private idealColumnOf(selection: ISelection): number {
        if (selection.idealColumn !== undefined) return selection.idealColumn;
        const content = this.document.getLineContent(selection.active.line);
        return this.displayLineFor(content).offsetToColumn(selection.active.character);
    }

    public cursorPageDown(inSelectionMode = false): void {
        this.cursorPage(1, inSelectionMode);
    }

    public cursorPageUp(inSelectionMode = false): void {
        this.cursorPage(-1, inSelectionMode);
    }

    /** A page is measured in VIEW lines: view zones take screen space too, stepping by document lines would overshoot. */
    private cursorPage(direction: 1 | -1, inSelectionMode: boolean): void {
        const pageSize = Math.max(1, this.viewportHeight - 1);
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            const idealAbs = this.idealColumnOf(sel);
            const currentView = this.viewLineForPosition(pos.line, pos.character);
            /* v8 ignore start -- defensive: reconcileHiddenCursors fixes a hidden cursor before commands run */
            if (currentView < 0) return sel;
            /* v8 ignore stop */
            const targetView = Math.min(Math.max(0, currentView + direction * pageSize), this.getViewLineCount() - 1);
            // A view zone row maps to the nearest document row, as in docLineForViewLine: above first, then below.
            const targetRow = this.nearestDocRow(this.buildProjection(), targetView);
            const idealInRow = Math.max(0, idealAbs - this.viewLineStartColumn(currentView));
            const landing = this.landOnRow(targetRow, idealInRow);
            return this.buildSelection(sel, landing.line, landing.character, landing.idealColumn, inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    public deleteRight(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                const pos = sel.active;
                const lineLen = this.document.getLineLength(pos.line);
                if (pos.character < lineLen) {
                    const lineContent = this.document.getLineContent(pos.line);
                    const dl = this.displayLineFor(lineContent);
                    const slotIndex = dl.slotIndexAtOffset(pos.character);
                    let nextEnd: number;
                    /* v8 ignore start -- the else is unreachable: Segmenter slots contiguously cover the line, so every in-range offset maps to a slot */
                    if (slotIndex >= 0) {
                        const slot = dl.slots[slotIndex];
                        nextEnd = slot.offset + slot.length;
                    } else {
                        nextEnd = Math.min(pos.character + 1, lineLen);
                    }
                    /* v8 ignore stop */
                    edits.push(createTextEdit(createRange(pos.line, pos.character, pos.line, nextEnd), ""));
                } else if (pos.line < this.document.lineCount - 1) {
                    edits.push(createTextEdit(createRange(pos.line, lineLen, pos.line + 1, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        if (edits.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
            this.adjustFoldingRegionsForEdits(edits);
            this.selections = this.selectionsAfterEdits(inverseEdits);
            this.ensureCursorVisible();
            return {
                label: "deleteRight",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: edits,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    public deleteWordLeft(): IUndoElement | undefined {
        return this.deleteLeftTo("deleteWordLeft", (line, character) => findWordBoundaryLeft(line, character));
    }

    public deleteAllLeft(): IUndoElement | undefined {
        return this.deleteLeftTo("deleteAllLeft", () => 0);
    }

    private deleteLeftTo(
        label: string,
        boundary: (line: string, character: number) => number,
    ): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                const pos = sel.active;
                if (pos.character > 0) {
                    const line = this.document.getLineContent(pos.line);
                    const start = boundary(line, pos.character);
                    edits.push(createTextEdit(createRange(pos.line, start, pos.line, pos.character), ""));
                } else if (pos.line > 0) {
                    const prevLineLen = this.document.getLineLength(pos.line - 1);
                    edits.push(createTextEdit(createRange(pos.line - 1, prevLineLen, pos.line, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        const clipped = clipDeletionOverlaps(edits);
        if (clipped.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.applyDocumentEdits(clipped);
            this.adjustFoldingRegionsForEdits(clipped);
            this.selections = this.selectionsAfterEdits(inverseEdits);
            this.ensureCursorVisible();
            return {
                label,
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: clipped,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    public deleteWordRight(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                const pos = sel.active;
                const lineLen = this.document.getLineLength(pos.line);
                if (pos.character < lineLen) {
                    const line = this.document.getLineContent(pos.line);
                    const wordEnd = findWordBoundaryRight(line, pos.character);
                    edits.push(createTextEdit(createRange(pos.line, pos.character, pos.line, wordEnd), ""));
                } else if (pos.line < this.document.lineCount - 1) {
                    edits.push(createTextEdit(createRange(pos.line, lineLen, pos.line + 1, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        const clipped = clipDeletionOverlaps(edits);
        if (clipped.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.applyDocumentEdits(clipped);
            this.adjustFoldingRegionsForEdits(clipped);
            this.selections = this.selectionsAfterEdits(inverseEdits);
            this.ensureCursorVisible();
            return {
                label: "deleteWordRight",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: clipped,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    /** A single-line selection inserts up to the next tab stop ({@link indentUnitAt}), a multi-line one adds a level to each line. */
    public indentLines(): IUndoElement | undefined {
        const spansMultipleLines = this.selections.some((sel) => {
            const range = selectionToRange(sel);
            return range.start.line !== range.end.line;
        });
        if (!spansMultipleLines) {
            return this.typeEach((range) => this.indentUnitAt(range.start));
        }
        return this.shiftIndent(1);
    }

    public outdentLines(): IUndoElement | undefined {
        return this.shiftIndent(-1);
    }

    /** Doesn't align to tab stops: upstream also adds exactly one level per line. */
    private indentUnit(): string {
        return this.insertSpaces ? " ".repeat(this.tabSize) : "\t";
    }

    /**
     * Up to the NEXT tab stop, as in upstream (`ab|` with tabSize 4 → column 4, not 6), by
     * visible column, not offset: a tab on the left or a wide grapheme shifts the tab stop.
     */
    private indentUnitAt(pos: IPosition): string {
        if (!this.insertSpaces) return "\t";
        const lineContent = this.document.getLineContent(pos.line);
        const visibleColumn = this.displayLineFor(lineContent).offsetToColumn(pos.character);
        return " ".repeat(this.tabSize - (visibleColumn % this.tabSize));
    }

    private shiftIndent(direction: 1 | -1): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const unit = this.indentUnit();
        const perLine = new Map<number, number>();
        const edits: ITextEdit[] = [];
        for (const line of this.collectTouchedLines()) {
            if (direction === 1) {
                edits.push(createTextEdit(createRange(line, 0, line, 0), unit));
                perLine.set(line, unit.length);
            } else {
                const removed = computeOutdentRemoval(this.document.getLineContent(line), this.tabSize);
                if (removed > 0) {
                    edits.push(createTextEdit(createRange(line, 0, line, removed), ""));
                    perLine.set(line, -removed);
                }
            }
        }

        if (edits.length === 0) return undefined;

        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.selections.map((sel) => this.remapSelectionForIndent(sel, perLine));
        this.ensureCursorVisible();
        return {
            label: direction === 1 ? "indent" : "outdent",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /** A selection end at column 0 of the next line doesn't include that line, as in upstream. */
    private collectTouchedLines(): number[] {
        const lines = new Set<number>();
        for (const sel of this.selections) {
            const range = selectionToRange(sel);
            let endLine = range.end.line;
            if (endLine > range.start.line && range.end.character === 0) {
                endLine--;
            }
            for (let line = range.start.line; line <= endLine; line++) {
                lines.add(line);
            }
        }
        return [...lines].sort((a, b) => a - b);
    }

    /** On indent, an end at column 0 stays at 0; on outdent, a point inside the removed part goes to line start. */
    private remapSelectionForIndent(sel: ISelection, perLine: Map<number, number>): ISelection {
        const remap = (pos: IPosition): IPosition => {
            const delta = perLine.get(pos.line);
            if (delta === undefined) return pos;
            if (delta > 0) {
                return { line: pos.line, character: pos.character === 0 ? 0 : pos.character + delta };
            }
            return { line: pos.line, character: Math.max(0, pos.character + delta) };
        };
        const anchor = remap(sel.anchor);
        const active = remap(sel.active);
        return createSelection(anchor.line, anchor.character, active.line, active.character);
    }

    public copyLinesUp(): IUndoElement | undefined {
        return this.applyLineOperation("copyLinesUp", computeCopyLines(this.document, this.sortedSelections(), false));
    }

    public copyLinesDown(): IUndoElement | undefined {
        return this.applyLineOperation("copyLinesDown", computeCopyLines(this.document, this.sortedSelections(), true));
    }

    public duplicateSelection(): IUndoElement | undefined {
        return this.applyLineOperation(
            "duplicateSelection",
            computeDuplicateSelection(this.document, this.sortedSelections()),
        );
    }

    public moveLinesUp(): IUndoElement | undefined {
        return this.applyLineOperation("moveLinesUp", computeMoveLines(this.document, this.sortedSelections(), false));
    }

    public moveLinesDown(): IUndoElement | undefined {
        return this.applyLineOperation("moveLinesDown", computeMoveLines(this.document, this.sortedSelections(), true));
    }

    public deleteLines(): IUndoElement | undefined {
        return this.applyLineOperation("deleteLines", computeDeleteLines(this.document, this.sortedSelections()));
    }

    /** Clamps to the document: the pure functions keep the cursor column, but the line under it may have shrunk. */
    private applyLineOperation(label: string, computed: ILineOperationResult | null): IUndoElement | undefined {
        if (this.readOnly || computed === null) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(computed.edits);
        this.adjustFoldingRegionsForEdits(computed.edits);
        this.selections = computed.afterSelections.map((sel) => this.clampSelectionToDocument(sel));
        this.ensureCursorVisible();
        return {
            label,
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: computed.edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /** Not just a guard: deleteLines puts the cursor on a line PAST the new document end, and the clamp brings it back. */
    private clampSelectionToDocument(sel: ISelection): ISelection {
        const clamp = (pos: IPosition): IPosition => {
            const line = Math.max(0, Math.min(pos.line, this.document.lineCount - 1));
            return { line, character: Math.max(0, Math.min(pos.character, this.document.getLineLength(line))) };
        };
        return { anchor: clamp(sel.anchor), active: clamp(sel.active), idealColumn: sel.idealColumn };
    }

    public getTextToCopy(emptySelectionClipboard: boolean): ITextToCopy {
        return computeTextToCopy(this.document, this.sortedSelections(), emptySelectionClipboard);
    }

    public cutSelections(emptySelectionClipboard: boolean): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits = computeCutEdits(this.document, this.sortedSelections(), emptySelectionClipboard);
        if (edits.length === 0) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.selectionsAfterEdits(inverseEdits);
        this.ensureCursorVisible();
        return {
            label: "cut",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * `pasteOnNewLine` is upstream's whole-line paste: a line copied from an EMPTY selection
     * goes in as a line above the cursor line; applies to each empty cursor separately.
     */
    public pasteText(text: string, pasteOnNewLine: boolean): IUndoElement | undefined {
        // Empty text (-1 === -1) passes too, harmlessly: both branches produce empty edits.
        const linewise = pasteOnNewLine && text.indexOf("\n") === text.length - 1;
        if (!linewise) return this.insertText(text);
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const sorted = this.sortedSelections();
        const edits = sorted.map((sel) =>
            isSelectionCollapsed(sel)
                ? createTextEdit(createRange(sel.active.line, 0, sel.active.line, 0), text)
                : createTextEdit(selectionToRange(sel), text),
        );
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        // A cursor at the end of the inserted text (start of the shifted line) goes back to its column.
        this.selections = this.selectionsAfterEdits(inverseEdits).map((after, i) =>
            isSelectionCollapsed(sorted[i])
                ? createCursorSelection(after.active.line, sorted[i].active.character)
                : after,
        );
        this.ensureCursorVisible();
        return {
            label: "paste",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    public ensureLineVisible(logicalLine: number): void {
        for (const region of this.foldedRegions) {
            if (region.isCollapsed && logicalLine > region.startLine && logicalLine <= region.endLine) {
                region.isCollapsed = false;
                this.bumpFoldsVersion();
            }
        }
    }

    public revealRange(range: IRange): void {
        this.ensureLineVisible(range.start.line);
        this.ensureLineVisible(range.end.line);
        this.revealPosition(range.start);
    }

    /** For commands that add a selection: after normalization the new one may end up anywhere, not in `selections[0]`. */
    public revealSelection(selection: ISelection): void {
        const range = selectionToRange(selection);
        this.ensureLineVisible(range.start.line);
        this.ensureLineVisible(range.end.line);
        this.revealPosition(selection.active);
    }

    /** After a folding recompute that may have collapsed a region around the edited line. */
    public ensurePrimaryCursorVisible(): void {
        if (this.selections.length === 0) return;
        this.ensureLineVisible(this.selections[0].active.line);
        this.ensureCursorVisible();
    }

    public get lineCount(): number {
        return this.document.lineCount;
    }

    public get primaryCursorLine(): number {
        return this.selections[0]?.active.line ?? 0;
    }

    public get primaryCursorColumn(): number {
        return this.selections[0]?.active.character ?? 0;
    }

    public goToPosition(line: number, character = 0): void {
        const clampedLine = Math.max(0, Math.min(line, this.document.lineCount - 1));
        const clampedChar = Math.max(0, Math.min(character, this.document.getLineLength(clampedLine)));
        this.selections = [createCursorSelection(clampedLine, clampedChar)];
        this.ensureLineVisible(clampedLine);
        this.revealPosition(this.selections[0].active);
        // A line past the end may still arrive (the index of a document on disk): the jump is finished then.
        this.pendingTarget =
            line > clampedLine ? { line, character, parkedAt: createPosition(clampedLine, clampedChar) } : null;
        this.pendingTargetMovedAt = Date.now();
    }

    /**
     * Growth of a document on disk: a Go to Line or Ctrl+End that was clamped to the provisional end carries
     * on to its target (or the new provisional end). A cursor the user moved off the parked spot, more than
     * one cursor, or any other change of the document drop the target.
     */
    private continuePendingTarget(change: IDocumentContentChange): boolean {
        const target = this.pendingTarget;
        if (target === null) return false;
        this.pendingTarget = null;
        if (change.isGrowth !== true) return false;
        const [only] = this.selectionsValue;
        if (
            this.selectionsValue.length !== 1 ||
            !isSelectionCollapsed(only) ||
            !positionsEqual(only.active, target.parkedAt)
        ) {
            // Stryker disable next-line BooleanLiteral: with the target dropped the growth has nothing left to remap, every position is before the old end
            return false;
        }
        // Every chunk of the index is a growth (80 a second on a 6 GB log): moving the parked cursor with each
        // one sent a selection and a layout message to the extension host each time (QA 4.3). The cursor moves
        // at most once per interval, at once when its line is in, and on the growth that ends the index.
        const reached = target.line < this.document.lineCount;
        if (
            !reached &&
            change.isFinalGrowth !== true &&
            Date.now() - this.pendingTargetMovedAt < this.growthFollowIntervalMs
        ) {
            this.pendingTarget = target;
            // Stryker disable next-line BooleanLiteral: the remap of a growth on the last line leaves the parked cursor where it is anyway
            return true;
        }
        // Re-parks itself while the target is still past the end.
        this.goToPosition(target.line, target.character);
        return true;
    }

    public restoreSelections(selections: readonly ISelection[]): void {
        this.selections = [...selections];
        if (this.selections.length > 0) this.ensureLineVisible(this.selections[0].active.line);
        this.ensureCursorVisible();
    }

    private ensureCursorVisible(): void {
        if (this.selections.length === 0) return;
        this.revealPosition(this.selections[0].active);
    }

    private revealPosition(pos: IPosition): void {
        if (this.viewportWidth <= 0 || this.viewportHeight <= 0) return;

        // With wrap, use the position's ROW, not the first fragment: otherwise a long line's tail stays off screen.
        const visualLine = this.viewLineForPosition(pos.line, pos.character);
        /* v8 ignore start -- callers (goToPosition/revealRange/restoreSelections) expand folds before revealing, so a hidden line never reaches here */
        if (visualLine < 0) return;
        /* v8 ignore stop */

        // The margin is capped at half the viewport, otherwise the edges would meet and push the cursor out.
        const maxMargin = Math.floor((this.viewportHeight - 1) / 2);
        const margin = Math.max(0, Math.min(this.cursorSurroundingLines, maxMargin));

        if (visualLine < this.scrollTop + margin) {
            this.scrollTop = Math.max(0, visualLine - margin);
        } else if (visualLine > this.scrollTop + this.viewportHeight - 1 - margin) {
            this.scrollTop = visualLine - this.viewportHeight + 1 + margin;
        }

        // No wrap gate here: the scrollLeft setter holds "wrap ⇒ 0", so the writes below are no-ops.
        const lineContent = this.document.getLineContent(pos.line);
        const dl = this.displayLineFor(lineContent);
        const col = dl.offsetToColumn(pos.character);
        // On a truncated line, reveal up to the last cell of the truncation badge, not a clipped badge at the edge.
        const revealCol = dl.isTruncated && col >= dl.displayWidth ? col + LONG_LINE_TRUNCATION_BADGE_WIDTH - 1 : col;
        if (col < this.scrollLeft) {
            this.scrollLeft = col;
        } else if (revealCol >= this.scrollLeft + this.viewportWidth) {
            this.scrollLeft = revealCol - this.viewportWidth + 1;
        }
    }

    private buildProjection(): IViewProjection {
        const wrapWidth = this.effectiveWrapWidth() ?? -1;
        const cache = this.projectionCache;
        if (
            // Stryker disable next-line ConditionalExpression: pure memoization, a rebuild gives the same rows
            cache !== null &&
            cache.docVersion === this.contentRevision &&
            cache.foldsVersion === this.foldsVersion &&
            cache.zonesVersion === this.zonesVersion &&
            cache.wrapWidth === wrapWidth &&
            cache.tabSize === this.tabSize
        ) {
            return cache.projection;
        }

        const hidden = collectHiddenRanges(this.foldedRegions);
        const pending = this.pendingProjectionChange;
        this.pendingProjectionChange = null;
        const lineCount = this.document.lineCount;
        const breaksCache = wrapWidth >= 0 ? this.wrapBreaks(wrapWidth) : null;
        const breaksFor = (line: number): readonly number[] | null => breaksCache?.getBreaks(line) ?? null;

        let projection: IViewProjection;
        // Stryker disable ConditionalExpression: the identity fast path and the replay are optimizations, the rows they give are the ones a rebuild gives
        if (hidden.length === 0 && wrapWidth < 0 && this.viewZonesValue.length === 0) {
            projection = new IdentityProjection(lineCount);
        } else if (cache !== null && this.canReplayInPlace(cache, hidden, pending, wrapWidth)) {
            if (pending !== null) cache.projection.applyLineChange(pending, hidden, breaksFor);
            projection = cache.projection;
        } else {
            projection = buildArrayProjection(lineCount, hidden, breaksFor, this.viewZonesValue);
        }
        // Stryker restore ConditionalExpression

        // Stryker disable next-line ObjectLiteral: pure memoization, an empty entry only means a rebuild on the next call
        this.projectionCache = {
            projection,
            docVersion: this.contentRevision,
            foldsVersion: this.foldsVersion,
            zonesVersion: this.zonesVersion,
            wrapWidth,
            tabSize: this.tabSize,
            hidden,
        };
        return projection;
    }

    /**
     * The cached rows can take the edit in place when the wrap inputs are the same, no zones are
     * involved on either side, and the collapsed folds after the edit are exactly the shifted
     * ones the rows were built with. A `false` is never wrong, only slower: the mutants that
     * widen it to a rebuild are equivalent.
     */
    private canReplayInPlace(
        cache: IProjectionCacheEntry,
        hidden: readonly IHiddenRange[],
        pending: IDocumentContentChange | null,
        wrapWidth: number,
    ): cache is IProjectionCacheEntry & { projection: ArrayProjection } {
        // Stryker disable next-line ConditionalExpression,BooleanLiteral,LogicalOperator: a false only costs a rebuild; an identity cache has no hidden ranges and fails the compare below anyway
        if (!(cache.projection instanceof ArrayProjection) || cache.projection.hasZones) return false;
        // Stryker disable next-line ConditionalExpression,EqualityOperator: see above, a rebuild gives the same rows
        if (this.viewZonesValue.length > 0 || cache.wrapWidth !== wrapWidth || cache.tabSize !== this.tabSize) {
            return false;
        }
        // Stryker disable next-line ConditionalExpression: see above
        if (pending === null) {
            // A version change without an event is a desync (as in LineBreaksCache): rebuild rather than guess.
            // Stryker disable next-line EqualityOperator,ConditionalExpression: the guard is unreachable in a synced document, every version change fires an event
            return cache.docVersion === this.contentRevision && hiddenRangesEqual(cache.hidden, hidden);
        }
        const expected = shiftHiddenRanges(cache.hidden, pending);
        // Stryker disable next-line ConditionalExpression: see above
        return expected !== null && hiddenRangesEqual(expected, hidden);
    }

    /** The closest visible line above, or -1; works for a hidden `logicalLine` too. */
    private previousVisibleLine(logicalLine: number): number {
        const projection = this.buildProjection();
        for (let line = logicalLine - 1; line >= 0; line--) {
            if (projection.firstRowOfDocLine(line) >= 0) return line;
        }
        return -1;
    }

    /** The closest visible line below, or -1; works for a hidden `logicalLine` too. */
    private nextVisibleLine(logicalLine: number): number {
        const projection = this.buildProjection();
        // Stryker disable next-line EqualityOperator: past the document firstRowOfDocLine is -1, the extra iteration returns nothing
        for (let line = logicalLine + 1; line < this.document.lineCount; line++) {
            // Stryker disable next-line EqualityOperator: a line after another one never starts at row 0
            if (projection.firstRowOfDocLine(line) >= 0) return line;
        }
        return -1;
    }

    /** Public: {@link UndoManager} applies edits bypassing {@link applyEdits} and must shift regions the same way. */
    public adjustFoldingRegionsForEdits(edits: readonly ITextEdit[]): void {
        const sorted = [...edits].sort((a, b) => comparePositions(b.range.start, a.range.start));

        for (const edit of sorted) {
            const editStartLine = edit.range.start.line;
            const editEndLine = edit.range.end.line;
            const insertedLineCount = edit.text.split("\n").length;
            const deletedLineCount = editEndLine - editStartLine;
            const lineDelta = insertedLineCount - 1 - deletedLineCount;
            this.adjustFoldingRegionsForLineChange(editStartLine, editEndLine, lineDelta);
        }
    }

    private adjustFoldingRegionsForLineChange(editStartLine: number, editEndLine: number, lineDelta: number): void {
        this.adjustViewZonesForLineChange(editStartLine, editEndLine, lineDelta);
        this.foldedRegions = this.foldedRegions.filter((region) => {
            if (editStartLine > region.endLine) {
                return true;
            }

            if (editEndLine < region.startLine) {
                region.startLine += lineDelta;
                region.endLine += lineDelta;
                return true;
            }

            if (editStartLine <= region.startLine && editEndLine >= region.startLine) {
                return false;
            }

            if (editStartLine > region.startLine && editEndLine <= region.endLine) {
                region.endLine += lineDelta;
                // Stryker disable next-line ConditionalExpression,EqualityOperator: always true, the edit starts past startLine and removes at most endLine - startLine - 1 lines; a safeguard
                return region.endLine > region.startLine;
            }

            /* v8 ignore start -- the fall-through else and the final `return true` are unreachable: reaching here needs editStartLine>endLine, but that case already returned at the "completely after" check */
            if (editStartLine > region.startLine && editStartLine <= region.endLine && editEndLine > region.endLine) {
                return false;
            }

            return true;
            /* v8 ignore stop */
        });
    }

    /**
     * View zones survive edits until the owner recomputes them. Cache and event are left alone:
     * the edit already bumps versionId and notifies render itself.
     */
    private adjustViewZonesForLineChange(editStartLine: number, editEndLine: number, lineDelta: number): void {
        if (this.viewZonesValue.length === 0 || lineDelta === 0) return;
        this.viewZonesValue = this.viewZonesValue.map((zone) => {
            if (zone.afterLine > editEndLine) {
                return { afterLine: zone.afterLine + lineDelta, size: zone.size };
            }
            if (zone.afterLine < editStartLine) return zone;
            const clamped = Math.max(editStartLine - 1, Math.min(zone.afterLine, editEndLine + lineDelta));
            return clamped === zone.afterLine ? zone : { afterLine: clamped, size: zone.size };
        });
    }

    private sortedSelections(): ISelection[] {
        return [...this.selections].sort((a, b) => {
            const rangeA = selectionToRange(a);
            const rangeB = selectionToRange(b);
            return comparePositions(rangeA.start, rangeB.start);
        });
    }

    private buildEditsFromSelections(textFor: (range: IRange) => string): ITextEdit[] {
        return this.sortedSelections().map((sel) => {
            const range = selectionToRange(sel);
            return createTextEdit(range, textFor(range));
        });
    }

    /**
     * Positions come from the INVERSE edits: their range, in applied-document coordinates, exactly
     * covers the inserted text, and its end is the cursor. Document order; callers zip by index
     * with `sortedSelections()`. Arithmetic on the original coordinates pushed cursors past the
     * line end on multi-line batches and crashed render.
     */
    private selectionsAfterEdits(inverseEdits: readonly ITextEdit[]): ISelection[] {
        return inverseEdits.map((inverse) =>
            createCursorSelection(inverse.range.end.line, inverse.range.end.character),
        );
    }

    private buildSelection(
        original: ISelection,
        newLine: number,
        newChar: number,
        idealColumn: number,
        inSelectionMode: boolean,
    ): ISelection {
        if (inSelectionMode) {
            return createSelection(original.anchor.line, original.anchor.character, newLine, newChar, idealColumn);
        }
        return createCursorSelection(newLine, newChar, idealColumn);
    }

    public cloneSelections(): ISelection[] {
        return this.selections.map((s) => ({ ...s, anchor: { ...s.anchor }, active: { ...s.active } }));
    }
}

/** One leading tab or up to `tabSize` spaces. */
function computeOutdentRemoval(content: string, tabSize: number): number {
    if (content.length === 0) return 0;
    if (content.startsWith("\t")) return 1;
    let count = 0;
    while (count < tabSize && content[count] === " ") {
        count++;
    }
    return count;
}

function firstNonWhitespaceIndex(content: string): number {
    for (let i = 0; i < content.length; i++) {
        if (!/\s/.test(content[i])) return i;
    }
    return content.length;
}

/**
 * A batch of deleting edits in document order: each start is raised to the previous end, a fully
 * covered edit is dropped. The document's `applyEdits` can't handle overlaps (two cursors in one
 * word): it ate "hello wo" instead of "hello" and produced negative columns. Merging is upstream behavior.
 */
function clipDeletionOverlaps(edits: readonly ITextEdit[]): ITextEdit[] {
    const clipped: ITextEdit[] = [];
    let previousEnd: IPosition | null = null;
    for (const edit of edits) {
        const limit = previousEnd ?? edit.range.start;
        // Stryker disable next-line EqualityOperator: on equality both branches give the same position (`limit` is `edit.range.start`), the `<` → `<=` mutant is equivalent
        const start = comparePositions(edit.range.start, limit) < 0 ? limit : edit.range.start;
        if (comparePositions(start, edit.range.end) >= 0) continue;
        clipped.push(
            createTextEdit(
                createRange(start.line, start.character, edit.range.end.line, edit.range.end.character),
                edit.text,
            ),
        );
        previousEnd = edit.range.end;
    }
    return clipped;
}

/** Like upstream Ctrl+Left: whitespace, then chars of one class. */
function findWordBoundaryLeft(line: string, offset: number): number {
    let pos = offset;
    while (pos > 0 && charClass(line[pos - 1]) === 0) {
        pos--;
    }
    if (pos === 0) return 0;
    const cls = charClass(line[pos - 1]);
    while (pos > 0 && charClass(line[pos - 1]) === cls) {
        pos--;
    }
    return pos;
}

/** Like upstream Ctrl+Right: chars of one class, then whitespace. */
function findWordBoundaryRight(line: string, offset: number): number {
    let pos = offset;
    const len = line.length;
    /* v8 ignore start -- unreachable via callers: both cursorWordRight and deleteWordRight only call this when offset < line length */
    if (pos >= len) return len;
    /* v8 ignore stop */
    const cls = charClass(line[pos]);
    while (pos < len && charClass(line[pos]) === cls) {
        pos++;
    }
    while (pos < len && charClass(line[pos]) === 0) {
        pos++;
    }
    return pos;
}
