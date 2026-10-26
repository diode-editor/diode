import { compositeOver, packRgb } from "@tuidom/core/common/colorUtils";
import type { DisplayLine } from "@tuidom/core/common/displayLine";
import type { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { Point } from "@tuidom/core/common/geometryPromitives";
import { measureTextWidth } from "@tuidom/core/common/measureTextWidth";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { TUIPasteEvent } from "@tuidom/core/dom/events/tuiPasteEvent";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import type { IScrollable, IScrollBarMarker } from "@tuidom/elements/scrollbar/iScrollable";

import { findFirstIdxMonotonousOrArrLen } from "../../base/common/arraysFind.ts";
import { runWhenGlobalIdle } from "../../base/common/async.ts";
import { codicon, iconGlyph } from "../../base/common/codicons.ts";
import { Emitter } from "../../base/common/event.ts";
import type { IDisposable } from "../../base/common/lifecycle.ts";
import type { IMarkerDecoration } from "../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { withCursorChangeSource } from "../common/core/cursorChangeSource.ts";
import type { IPosition } from "../common/core/iPosition.ts";
import { comparePositions } from "../common/core/iPosition.ts";
import type { IRange } from "../common/core/iRange.ts";
import {
    createCursorSelection,
    createSelection,
    isSelectionCollapsed,
    selectionToRange,
} from "../common/core/iSelection.ts";
import { findWordRangeAt } from "../common/core/wordClassification.ts";
import { findSurroundingPair, planAutoClose } from "../common/languages/autoClosing.ts";
import type { ISemanticTokensLegend } from "../common/languages/iSemanticTokensSource.ts";
import {
    type ISemanticTokenStyleResolver,
    NULL_SEMANTIC_TOKEN_STYLE_RESOLVER,
    type SemanticTokenStyle,
} from "../common/languages/iSemanticTokenStyleResolver.ts";
import type { ITokenStyleResolver, ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../common/languages/iTokenStyleResolver.ts";
import type { IResolvedLanguageConfiguration } from "../common/languages/languageConfiguration.ts";
import type { IExternalDecorations, IViewZoneDecoration } from "../common/model/iEditorDecoration.ts";
import { EMPTY_EXTERNAL_DECORATIONS } from "../common/model/iEditorDecoration.ts";
import type { IGhostText } from "../common/model/iGhostText.ts";
import { ghostTextEquals } from "../common/model/iGhostText.ts";
import type { IGutterChangeDecoration } from "../common/model/iGutterChangeDecoration.ts";
import type { IUndoElement } from "../common/model/iUndoElement.ts";
import { UndoManager } from "../common/model/undoManager.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { LineWidthCache } from "../common/viewModel/lineWidthCache.ts";
import {
    LONG_LINE_TRUNCATION_BADGE,
    LONG_LINE_TRUNCATION_BADGE_WIDTH,
    STOP_RENDERING_LINE_AFTER,
} from "../common/viewModel/longLineRendering.ts";
import { computeWordOccurrences } from "../contrib/find/computeWordOccurrences.ts";
import { computeIndentLevel } from "../contrib/folding/foldingRangeProvider.ts";
import type { IFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import type { ILinePhantom, ITextViewportGeometry } from "./textViewRendering.ts";
import {
    buildViewportRows,
    caretLocalCell,
    composedLineContent,
    composedOffset,
    docPositionAt,
    forEachRangeCell,
    paintCarets,
    paintPhantomText,
    paintRangeBackground,
    paintSortedRangeBackgrounds,
    paintTextLine,
} from "./textViewRendering.ts";
import { resolveSemanticTokenStyle, SemanticTokenIndex, TokenIndex } from "./tokenIndex.ts";

const FIND_MATCH_BG = packRgb(98, 91, 23);
const FIND_MATCH_CURRENT_BG = packRgb(168, 109, 0);
const NO_RANGES: readonly IRange[] = [];
const NO_CACHED_SCROLL_BAR_MARKERS: ICachedScrollBarMarkers = { sources: [], markers: [] };

/** Upstream `WordHighlighter.runDelayer`: the occurrence query runs once the cursor settles. */
const OCCURRENCE_RUN_DELAY_MS = 50;
/**
 * Lines the width sweep measures per idle slice: about a millisecond of code lines through
 * the generic grapheme path, so a keystroke between slices never waits on it.
 */
export const WIDTH_SWEEP_BATCH_LINES = 128;

/**
 * Who wins a scrollbar cell shared by several marks. VS Code splits the ruler into lanes; a
 * terminal cell has one foreground, so the lanes collapse into an order of importance.
 */
const enum ScrollBarMarkerPriority {
    WordHighlight = 1,
    GutterChange = 2,
    FindMatch = 3,
    Info = 4,
    Warning = 5,
    Error = 6,
}
const NO_GUTTER_CHANGE_DECORATIONS: readonly IGutterChangeDecoration[] = [];
// In a cell grid VS Code's thin dirty-diff border becomes a bold vertical bar centered in the
// cell; modified is dashed (VS Code uses hatching).
const GUTTER_CHANGE_BAR = "┃";
const GUTTER_CHANGE_BAR_DASHED = "┋";
const GUTTER_LEFT_PADDING = 2;

// Codicons as in VS Code: thinner than the file tree's Nerd Font fa-angle, they don't crowd the text.
const FOLD_ICON_EXPANDED = codicon("chevron-down");
const FOLD_ICON_COLLAPSED = codicon("chevron-right");
const FOLD_GAP_LEFT = 1;
const FOLD_GAP_RIGHT = 1;
const FOLD_COLLAPSED_MARKER = "⋯";

const INDENT_GUIDE = "▏";

/**
 * Row + column rather than a `y * width + x` key: a division mutant collapses distinct cells
 * into one, and the marker pass starts mistaking text for a guide.
 */
type IndentGuideCells = ReadonlyMap<number, ReadonlySet<number>>;

const NO_GUIDE_CELLS: IndentGuideCells = new Map<number, ReadonlySet<number>>();

/** Marks built from `sources`; equal sources (by identity) give the same marks. */
interface ICachedScrollBarMarkers {
    readonly sources: readonly unknown[];
    readonly markers: readonly IScrollBarMarker[];
}

function sameSources(a: readonly unknown[], b: readonly unknown[]): boolean {
    return a.length === b.length && a.every((source, i) => source === b[i]);
}

function sameMarkers(a: readonly IScrollBarMarker[], b: readonly IScrollBarMarker[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (m, i) =>
                m.start === b[i].start && m.end === b[i].end && m.color === b[i].color && m.priority === b[i].priority,
        )
    );
}

/** `ranges` sorted and not overlapping; both ends count, as upstream `Range.containsPosition`. */
function sortedRangesContain(ranges: readonly IRange[], pos: IPosition): boolean {
    const i = findFirstIdxMonotonousOrArrLen(ranges, (range) => comparePositions(range.end, pos) >= 0);
    return i < ranges.length && comparePositions(ranges[i].start, pos) <= 0;
}

export class EditorElement extends TUIElement implements IScrollable {
    public readonly viewState: EditorViewState;
    /** A file editor puts the document's shared manager here: one history however many views show it. */
    public undoManager: UndoManager;
    public tokenStyleResolver: ITokenStyleResolver = NULL_TOKEN_STYLE_RESOLVER;

    public semanticTokenStyleResolver: ISemanticTokenStyleResolver = NULL_SEMANTIC_TOKEN_STYLE_RESOLVER;

    /**
     * A function, not a snapshot: the buffer language can change (Save As), and the
     * configuration can arrive later (lazy loading).
     */
    public languageConfigurationSource: (() => IResolvedLanguageConfiguration | undefined) | null = null;

    private readonly onDidTypeEmitter = new Emitter<string>();

    /**
     * Upstream `ICodeEditor.onDidType`: fires AFTER the edit, including auto-close, typeover
     * and auto-surround. Paste, Enter, undo and extension edits are not typing; subscribers
     * (popup trigger characters) need typing specifically.
     */
    public readonly onDidType = this.onDidTypeEmitter.event;

    public get tabSize(): number {
        return this.viewState.tabSize;
    }

    public set tabSize(value: number) {
        this.viewState.tabSize = value;
    }

    public get occurrenceHighlightEnabled(): boolean {
        return this.occurrenceHighlightEnabledValue;
    }

    public set occurrenceHighlightEnabled(enabled: boolean) {
        // Off hides the set at once (`occurrenceCaret`), on queries again.
        this.occurrenceHighlightEnabledValue = enabled;
        this.requestOccurrences();
    }

    /**
     * `null` means the editor's own background: a theme may pin `editorGutter.background` to
     * `editor.background`, and an editor with its own background (Output) would get a foreign gutter strip.
     */
    public gutterBackgroundToken: string | null = "editorGutter.background";
    /** `diode.icons.nerdFont`: Nerd Font or plain Unicode folding chevrons. */
    public nerdFont = true;

    /** Stored by the document: ranges move with the text on edits. */
    public get markerDecorations(): readonly IMarkerDecoration[] {
        return this.viewState.getMarkerDecorations();
    }

    public set markerDecorations(decorations: readonly IMarkerDecoration[]) {
        this.viewState.setMarkerDecorations(decorations);
    }

    public gutterChangeDecorations: readonly IGutterChangeDecoration[] = NO_GUTTER_CHANGE_DECORATIONS;
    public decorations: IExternalDecorations = EMPTY_EXTERNAL_DECORATIONS;

    private lineWidthCache: LineWidthCache | null = null;
    /**
     * The large-file mode has no {@link LineWidthCache}: its array of one number per line and the idle sweep over
     * the file are what the mode avoids (for a document on disk the sweep would read the whole file). Like
     * upstream `ViewLines._maxLineWidth`, the width is the widest line painted so far.
     */
    private largeFileMaxWidth = 0;
    /** The pending idle slice of the width sweep ({@link runWidthSweep}); null while none is scheduled. */
    private widthSweep: IDisposable | null = null;
    private occurrenceHighlightEnabledValue = true;
    /**
     * Word occurrences are computed off the frame path, like the upstream `WordHighlighter`: a
     * request arms a timer after the next frame, the timer runs the query. The ranges are sorted;
     * an edit drops them (upstream `_stopAll`), so they always match the text.
     */
    private occurrences: readonly IRange[] | null = null;
    // The first query waits for the first frame: a big file shows its text before the search.
    private occurrenceRunRequested = true;
    private occurrenceTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * The cursor move of an edit (typing, Enter, undo) is not an explicit move: upstream keeps
     * the highlight off until the next one (`CursorChangeReason`). The edit and its cursor move
     * share one synchronous task, in either order: the view state remaps selections inside the
     * content event, before this element hears it. So a request made in the task of an edit is
     * withdrawn, and a cursor move after the edit in the same task makes none.
     */
    private occurrenceTask: { edited: boolean; requested: boolean } | null = null;
    private occurrenceMarkers = NO_CACHED_SCROLL_BAR_MARKERS;
    private findMarkers = NO_CACHED_SCROLL_BAR_MARKERS;
    private scrollBarMarkers: {
        readonly occurrences: readonly IScrollBarMarker[];
        readonly find: readonly IScrollBarMarker[];
        readonly small: readonly IScrollBarMarker[];
        readonly markers: readonly IScrollBarMarker[];
    } | null = null;
    private ghostTextValue: IGhostText | null = null;
    private renderedDocLines: { first: number; last: number } | undefined;

    public get ghostText(): IGhostText | null {
        return this.ghostTextValue;
    }

    /**
     * The element puts the suggestion's tail (lines after the first) into its own view zones. They
     * are mutually exclusive with the owner's zones ({@link decorations}), so ghost text exists only
     * in the file editor and is off in diff (where `diffEditorPane2` owns the zones).
     */
    public setGhostText(ghost: IGhostText | null): void {
        if (ghostTextEquals(this.ghostTextValue, ghost)) return;
        const hadZones = (this.ghostTextValue?.lines.length ?? 1) > 1;
        this.ghostTextValue = ghost;
        const needsZones = ghost !== null && ghost.lines.length > 1;
        // setViewZones replaces the WHOLE zone set, so leave it alone unless ghost text uses
        // zones: foreign zones (should any appear) stay intact.
        if (hadZones || needsZones) {
            this.viewState.setViewZones(needsZones ? [{ afterLine: ghost.line, size: ghost.lines.length - 1 }] : []);
        }
        this.markDirty();
    }

    public get contentHeight(): number {
        return this.viewState.getViewLineCount();
    }

    /**
     * Overview ruler marks for the scrollbar, in view rows: what the file has highlighted
     * (diagnostics, find matches, SCM changes, occurrences of the word under the cursor).
     * The scrollbar reads them every frame, and occurrences or find matches of a common word in
     * a big file number in the hundreds of thousands: those two sets are mapped to rows once per
     * change of the set or of the projection, and while nothing changes the result is the same
     * array.
     */
    public getScrollBarMarkers(): readonly IScrollBarMarker[] {
        const vs = this.viewState;
        // The projection: rows move with the text, folds, view zones, wrap and tab width.
        const projection = [
            vs.document.versionId,
            vs.foldStateVersion,
            vs.viewZones,
            vs.isWordWrapActive ? vs.viewportWidth : null,
            vs.tabSize,
        ];
        const occurrences = this.getOccurrenceHighlights();
        const searchMatches = vs.searchMatches;
        this.occurrenceMarkers = this.rangeMarkers(
            this.occurrenceMarkers,
            occurrences,
            "editorOverviewRuler.wordHighlightForeground",
            ScrollBarMarkerPriority.WordHighlight,
            projection,
        );
        this.findMarkers = this.rangeMarkers(
            this.findMarkers,
            searchMatches,
            "editorOverviewRuler.findMatchForeground",
            ScrollBarMarkerPriority.FindMatch,
            projection,
        );

        // The SCM bar colors arrive resolved, so the ruler reuses them instead of the
        // `editorOverviewRuler.{added,modified,deleted}Foreground` tokens.
        const changeMarkers = this.gutterChangeDecorations.map((change) =>
            this.scrollBarMarker(change.range, change.color, ScrollBarMarkerPriority.GutterChange),
        );
        const diagnosticMarkers: IScrollBarMarker[] = [];
        for (const { range, severity } of this.markerDecorations) {
            // Hints have no ruler mark in VS Code either.
            if (severity === MarkerSeverity.Hint) continue;
            const lane = this.severityRulerLane(severity);
            diagnosticMarkers.push(this.scrollBarMarker(range, lane.color, lane.priority));
        }
        const small = [...changeMarkers, ...diagnosticMarkers];

        const cached = this.scrollBarMarkers;
        if (
            cached?.occurrences === this.occurrenceMarkers.markers &&
            cached.find === this.findMarkers.markers &&
            sameMarkers(cached.small, small)
        ) {
            return cached.markers;
        }
        const markers = this.occurrenceMarkers.markers.concat(
            changeMarkers,
            this.findMarkers.markers,
            diagnosticMarkers,
        );
        this.scrollBarMarkers = {
            occurrences: this.occurrenceMarkers.markers,
            find: this.findMarkers.markers,
            small,
            markers,
        };
        return markers;
    }

    /** Rebuilds `cache` only when the ranges, their color or the projection change. */
    private rangeMarkers(
        cache: ICachedScrollBarMarkers,
        ranges: readonly IRange[],
        colorToken: string,
        priority: number,
        projection: readonly unknown[],
    ): ICachedScrollBarMarkers {
        if (ranges.length === 0) return NO_CACHED_SCROLL_BAR_MARKERS;
        // Tokens resolve only when there is something to mark: a bare element has no theme.
        const color = this.styleVar(colorToken);
        const sources = [ranges, color, ...projection];
        if (sameSources(cache.sources, sources)) return cache;
        return { sources, markers: ranges.map((range) => this.scrollBarMarker(range, color, priority)) };
    }

    private scrollBarMarker(range: IRange, color: number, priority: number): IScrollBarMarker {
        const start = this.viewRowForPosition(range.start.line, range.start.character);
        const end = this.viewRowForPosition(range.end.line, range.end.character);
        return { start, end: end + 1, color, priority };
    }

    private severityRulerLane(severity: Exclude<MarkerSeverity, MarkerSeverity.Hint>): {
        color: number;
        priority: number;
    } {
        switch (severity) {
            case MarkerSeverity.Error:
                return {
                    color: this.styleVar("editorOverviewRuler.errorForeground"),
                    priority: ScrollBarMarkerPriority.Error,
                };
            case MarkerSeverity.Warning:
                return {
                    color: this.styleVar("editorOverviewRuler.warningForeground"),
                    priority: ScrollBarMarkerPriority.Warning,
                };
            case MarkerSeverity.Info:
                return {
                    color: this.styleVar("editorOverviewRuler.infoForeground"),
                    priority: ScrollBarMarkerPriority.Info,
                };
        }
    }

    /** A line hidden by a fold marks the fold's header row, the one the user can see. */
    private viewRowForPosition(line: number, character: number): number {
        // Past the end, `logicalToVisualLine` is -1 too, so the loop walks back to the last line.
        let visibleLine = Math.min(line, this.viewState.document.lineCount);
        // Stryker disable next-line ConditionalExpression,EqualityOperator: line 0 is never hidden, the guard only stops a runaway loop
        while (visibleLine > 0 && this.viewState.logicalToVisualLine(visibleLine) < 0) visibleLine--;
        if (visibleLine !== line) return Math.max(0, this.viewState.logicalToVisualLine(visibleLine));
        return Math.max(0, this.viewState.viewLineForPosition(line, character));
    }

    /**
     * The width the horizontal scrollbar shows: like upstream `ViewLines._maxLineWidth`, the
     * widest line seen so far. The viewport's lines are measured here, on the frame; the rest
     * of the file follows in idle slices ({@link runWidthSweep}), so a big file shows its text
     * before its width is known and the scrollbar grows as long lines turn up.
     */
    public get contentWidth(): number {
        // Under wrap the content is no wider than the viewport, so the horizontal scrollbar has nothing to show.
        if (this.viewState.isWordWrapActive) return this.viewState.viewportWidth;
        if (this.viewState.isTooLargeForTokenization) return this.measureVisibleWidth();
        // The cache binds to the document once: an EditorElement's document never changes (a reload
        // from disk builds a new element).
        const cache = (this.lineWidthCache ??= new LineWidthCache(this.viewState.document, this.tabSize));
        cache.setTabSize(this.tabSize);
        cache.measureLines(this.visibleDocLines());
        // Stryker disable next-line ConditionalExpression: a slice scheduled with nothing left finds nothing
        if (cache.hasUnmeasuredLines) this.scheduleWidthSweep(cache);
        return cache.getMaxWidth();
    }

    /** The widest of the viewport's lines and of those painted before; a reload starts over. */
    private measureVisibleWidth(): number {
        const document = this.viewState.document;
        for (const line of this.visibleDocLines()) {
            const content = document.getLineContent(line);
            let width = measureTextWidth(content, this.tabSize, STOP_RENDERING_LINE_AFTER);
            if (content.length > STOP_RENDERING_LINE_AFTER) width += LONG_LINE_TRUNCATION_BADGE_WIDTH;
            // Stryker disable next-line EqualityOperator: storing an equal width changes nothing — equivalent
            if (width > this.largeFileMaxWidth) this.largeFileMaxWidth = width;
        }
        return this.largeFileMaxWidth;
    }

    /** Document lines on the viewport's rows (a row of a view zone or past the end maps to the nearest line). */
    private visibleDocLines(): number[] {
        const vs = this.viewState;
        const first = vs.scrollTop;
        return Array.from({ length: vs.viewportHeight }, (_, row) => vs.docLineForViewLine(first + row));
    }

    /**
     * A detached editor (closed tab, hidden group) has no frame to widen: the sweep stops with
     * it ({@link onDidDisconnect}) and the first frame after a reattach schedules it again.
     */
    private scheduleWidthSweep(cache: LineWidthCache): void {
        if (this.widthSweep !== null || !this.isConnected) return;
        this.widthSweep = runWhenGlobalIdle(() => {
            this.widthSweep = null;
            this.runWidthSweep(cache);
        });
    }

    /** One slice of the sweep; a wider maximum is a new scrollbar, so it asks for a frame. */
    private runWidthSweep(cache: LineWidthCache): void {
        const before = cache.getMaxWidth();
        const more = cache.measurePending(WIDTH_SWEEP_BATCH_LINES);
        // Under wrap the width on screen is the viewport's: nothing to repaint.
        if (cache.getMaxWidth() !== before && !this.viewState.isWordWrapActive) this.markDirty();
        if (more) this.scheduleWidthSweep(cache);
    }

    protected override onDidDisconnect(): void {
        this.widthSweep?.dispose();
        this.widthSweep = null;
    }

    public get scrollTop(): number {
        return this.viewState.scrollTop;
    }

    public get scrollLeft(): number {
        return this.viewState.scrollLeft;
    }

    public override inspectState(): Record<string, unknown> {
        const vs = this.viewState;
        const selections = vs.selections.map((s) => ({
            anchor: { line: s.anchor.line, character: s.anchor.character },
            active: { line: s.active.line, character: s.active.character },
            collapsed: s.anchor.line === s.active.line && s.anchor.character === s.active.character,
        }));
        return {
            readOnly: vs.readOnly,
            languageId: vs.document.languageId,
            lineCount: vs.document.lineCount,
            wordWrap: vs.wordWrap,
            wordWrapColumn: vs.wordWrapColumn,
            viewLineCount: vs.getViewLineCount(),
            tabSize: vs.tabSize,
            insertSpaces: vs.insertSpaces,
            scrollTop: vs.scrollTop,
            scrollLeft: vs.scrollLeft,
            selections,
            hasSelection: selections.some((s) => !s.collapsed),
            foldedRegions: vs.foldedRegions.map((r) => ({ startLine: r.startLine, endLine: r.endLine })),
            viewZones: vs.viewZones.map((z) => ({ afterLine: z.afterLine, size: z.size })),
            // Background work after open, for the perf gate (e2e/bench): the keystroke is measured once both
            // have settled, otherwise it measures the tokenizer's backlog, not the edit.
            tokenizationComplete: vs.tokenStore?.isBackgroundTokenizationCompleted ?? true,
            // Under wrap the width is the viewport's and the sweep never runs; before the first frame nothing
            // is measured yet.
            contentWidthFinal:
                vs.isWordWrapActive ||
                vs.isTooLargeForTokenization ||
                (this.lineWidthCache !== null && !this.lineWidthCache.hasUnmeasuredLines),
            ghostText:
                this.ghostTextValue === null
                    ? null
                    : {
                          line: this.ghostTextValue.line,
                          character: this.ghostTextValue.character,
                          lines: [...this.ghostTextValue.lines],
                      },
        };
    }

    public get gutterWidth(): number {
        // Logical lines, not view lines: folding must not narrow the digit column
        // (a 150-line file folded below 100 would cut "150" to "15").
        const lineCount = this.viewState.document.lineCount;
        const digitCount = Math.max(1, Math.floor(Math.log10(lineCount)) + 1);
        return GUTTER_LEFT_PADDING + digitCount + this.gutterMarkerColumns + FOLD_GAP_LEFT + 1 + FOLD_GAP_RIGHT;
    }

    private get gutterMarkerColumns(): number {
        return (this.decorations.gutterMarkers?.length ?? 0) > 0 ? 1 : 0;
    }

    public get foldControlColumn(): number {
        return this.gutterWidth - 1 - FOLD_GAP_RIGHT;
    }

    public getCaretScreenCell(): Point | null {
        const local = caretLocalCell(this.viewState, this.gutterWidth, this.layoutSize, this.linePhantom);
        if (local === null) return null;
        return new Point(this.globalPosition.x + local.x, this.globalPosition.y + local.y);
    }

    /** One value for all passes of a frame: line, range backgrounds, cursors and hit-test. */
    private get linePhantom(): ILinePhantom | null {
        const ghost = this.ghostTextValue;
        if (ghost === null) return null;
        const document = this.viewState.document;
        // The suggestion may be stale (an external edit landed before the service ended the session):
        // all composed-line math of the frame relies on "the phantom lies within its line", so clamp here.
        if (ghost.line < 0 || ghost.line >= document.lineCount) return null;
        return {
            line: ghost.line,
            offset: Math.min(ghost.character, document.getLineLength(ghost.line)),
            text: ghost.lines[0],
        };
    }

    /**
     * Viewport size is written to the view state BEFORE render: under wrap the projection depends
     * on width, and ScrollBarDecorator decides bar visibility from the PREVIOUS width's projection,
     * so a width change requests one more frame. Via microtask: markDirty straight from layout
     * would leave the root layout-dirty after the frame.
     */
    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const textWidth = size.width - this.gutterWidth;
        const changed = this.viewState.viewportWidth !== textWidth || this.viewState.viewportHeight !== size.height;
        this.viewState.viewportWidth = textWidth;
        this.viewState.viewportHeight = size.height;
        if (changed && this.viewState.isWordWrapActive) {
            queueMicrotask(() => {
                this.markDirty();
            });
        }
        return size;
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return 1;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.contentWidth;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return this.contentHeight;
    }

    public constructor(viewState: EditorViewState) {
        super();
        this.focusable = true;
        this.viewState = viewState;
        this.undoManager = new UndoManager(viewState.document);

        this.viewState.onDidChangeCursorPosition(() => {
            const task = this.currentOccurrenceTask();
            if (!task.edited) {
                task.requested = true;
                this.requestOccurrences();
            }
            this.markDirty();
        });
        // Scroll, folding and edits away from the cursor (extension applyEdits) too: under
        // damage tracking an unmarked widget is not repainted.
        this.viewState.onDidChangeView(() => {
            this.markDirty();
        });
        this.viewState.document.onDidChangeContent((change) => {
            if (change.isFlush === true) this.largeFileMaxWidth = 0;
            // Upstream `onDidChangeModelContent` → `_stopAll`: no full-file search per keystroke.
            this.dropOccurrences();
            const task = this.currentOccurrenceTask();
            task.edited = true;
            if (task.requested) this.occurrenceRunRequested = false;
            this.markDirty();
        });

        // The extension bridge reads the cursor change source synchronously (`TextEditorSelectionChangeKind`).
        this.addEventListener("keypress", (event) => {
            withCursorChangeSource("keyboard", () => {
                this.handleKeyPress(event);
            });
        });
        this.addEventListener("paste", (event) => {
            withCursorChangeSource("keyboard", () => {
                this.handlePaste(event);
            });
        });
        this.addEventListener("mousedown", (event) => {
            withCursorChangeSource("mouse", () => {
                this.handleMouseDown(event);
            });
        });
        this.addEventListener("dblclick", (event) => {
            withCursorChangeSource("mouse", () => {
                this.handleDoubleClick(event);
            });
        });
        this.addEventListener("mousemove", (event) => {
            withCursorChangeSource("mouse", () => {
                this.handleMouseMove(event);
            });
        });
        this.addEventListener("mouseup", () => {
            this.dragAnchor = null;
        });
        this.addEventListener("mouseleave", () => {
            this.setFoldGutterHovered(false);
        });
        this.addEventListener("wheel", (event) => {
            this.handleWheel(event);
        });
    }

    /** Set via `TextEditorPane.readOnly`, which also fires the event. */
    public get readOnly(): boolean {
        return this.viewState.readOnly;
    }

    /** Background tokenization lands in ~1 ms chunks: a frame per off-screen chunk is wasted. */
    public handleTokensChanged(fromLine: number, toLine: number): void {
        const rendered = this.renderedDocLines;
        if (rendered === undefined || toLine < rendered.first || fromLine > rendered.last) return;
        this.markDirty();
    }

    public render(context: RenderContext): void {
        const gutterW = this.gutterWidth;
        const contentCols = this.layoutSize.width - gutterW;
        const scrollTop = this.viewState.scrollTop;
        const scrollLeft = this.viewState.scrollLeft;
        const visibleLines = this.layoutSize.height;
        const viewLineCount = this.viewState.getViewLineCount();

        const editorFg = this.resolvedStyle.fg;
        const editorBg = this.resolvedStyle.bg;
        const gutBg =
            this.gutterBackgroundToken === null ? editorBg : this.styleVar(this.gutterBackgroundToken, editorBg);
        const lnFg = this.styleVar("editorLineNumber.foreground");
        const lnActiveFg = this.styleVar("editorLineNumber.activeForeground");

        const primaryLine = this.viewState.selections[0].active.line;
        const digitCount =
            gutterW - GUTTER_LEFT_PADDING - this.gutterMarkerColumns - FOLD_GAP_LEFT - 1 - FOLD_GAP_RIGHT;
        const foldFg = this.styleVar("editorGutter.foldingControlForeground");
        // Italic, like VS Code ghost text (`.ghost-text-decoration`).
        const ghost = this.ghostTextValue;
        const ghostFg = ghost !== null ? this.styleVar("editorGhostText.foreground") : 0;
        const phantom = this.linePhantom;

        const foldHeaderByLine = new Map<number, boolean>();
        for (const region of this.viewState.foldedRegions) {
            foldHeaderByLine.set(region.startLine, region.isCollapsed);
        }

        // A deleted hunk is a single boundary line (its range covers only that line).
        const gutterChangeByLine = new Map<number, { color: number; dashed: boolean }>();
        for (const decoration of this.gutterChangeDecorations) {
            for (let line = decoration.range.start.line; line <= decoration.range.end.line; line++) {
                gutterChangeByLine.set(line, { color: decoration.color, dashed: decoration.dashed === true });
            }
        }

        // A token with alpha is composited over the editor background once, here: the line is painted
        // in several passes, and a translucent bg would stack a new layer in each.
        const lineBgByLine = new Map<number, number>();
        for (const decoration of this.decorations.lineBackgrounds ?? []) {
            const bg = compositeOver(this.styleVar(decoration.colorToken), editorBg);
            for (let line = decoration.startLine; line <= decoration.endLine; line++) {
                lineBgByLine.set(line, bg);
            }
        }
        const gutterMarkerByLine = new Map<number, string>();
        for (const marker of this.decorations.gutterMarkers ?? []) {
            gutterMarkerByLine.set(marker.line, marker.char);
        }
        const zoneDecorationByAnchor = new Map<number, IViewZoneDecoration>();
        for (const zone of this.decorations.zones ?? []) {
            zoneDecorationByAnchor.set(zone.afterLine, zone);
        }

        // The bottom viewport row may be a view zone; docLineForViewLine takes the nearest document
        // line, otherwise highlighting at the viewport tail silently lags.
        const tokenStore = this.viewState.tokenStore;
        if (tokenStore && visibleLines > 0) {
            const firstDocLine = this.viewState.docLineForViewLine(scrollTop);
            const lastDocLine = this.viewState.docLineForViewLine(scrollTop + visibleLines - 1);
            this.renderedDocLines = { first: firstDocLine, last: lastDocLine };
            tokenStore.tokenizeViewport(firstDocLine, lastDocLine);
        }

        const tokenStyleResolver = this.tokenStyleResolver;
        const resolveStyle = (metadata: number): ResolvedTokenStyle => tokenStyleResolver.resolve(metadata);
        const semanticLanguageId = this.viewState.document.languageId;
        const semanticStyleCache = new Map<ISemanticTokensLegend, Map<number, SemanticTokenStyle | null>>();
        const lookupSemanticStyle = (
            legend: ISemanticTokensLegend,
            tokenType: number,
            tokenModifiers: number,
        ): SemanticTokenStyle | null => {
            let byLegend = semanticStyleCache.get(legend);
            if (byLegend === undefined) {
                byLegend = new Map();
                semanticStyleCache.set(legend, byLegend);
            }
            // Type < 65536 (API contract), modifiers are 32 bits: the key is collision-free.
            // Stryker disable next-line ArithmeticOperator: "-" and "/" also give a collision-free key
            const key = tokenType * 0x1_0000_0000 + tokenModifiers;
            let style = byLegend.get(key);
            if (style === undefined) {
                style = resolveSemanticTokenStyle(
                    this.semanticTokenStyleResolver,
                    semanticLanguageId,
                    legend,
                    tokenType,
                    tokenModifiers,
                );
                byLegend.set(key, style);
            }
            return style;
        };

        // Under wrap, N fragments of one line must not segment it N times.
        const dlByDocLine = new Map<number, DisplayLine>();

        for (let screenY = 0; screenY < visibleLines; screenY++) {
            const viewLine = scrollTop + screenY;

            // View zone row: consumes no line number; content comes from the zone owner.
            const zoneRow = this.viewState.zoneRowForViewLine(viewLine);
            if (zoneRow !== null) {
                for (let x = 0; x < gutterW; x++) {
                    context.setCell(x, screenY, { char: " ", bg: gutBg });
                }
                // The editor's own zone exists only for ghost text (see setGhostText): a single zone at
                // ghost.line of exactly lines.length - 1 rows, so mutants weakening the anchor and
                // offset checks are unreachable.
                // Stryker disable next-line ConditionalExpression,EqualityOperator,ArithmeticOperator: see above
                if (ghost !== null && zoneRow.anchor === ghost.line && zoneRow.offset + 1 < ghost.lines.length) {
                    // The extra column of a "<=" mutant is clipped by the element rectangle.
                    // Stryker disable next-line EqualityOperator: see above
                    for (let x = 0; x < contentCols; x++) {
                        context.setCell(gutterW + x, screenY, { char: " ", fg: ghostFg, bg: editorBg });
                    }
                    paintPhantomText(context, {
                        displayLine: this.viewState.displayLineFor(ghost.lines[zoneRow.offset + 1]),
                        screenY,
                        gutterW,
                        contentCols,
                        fg: ghostFg,
                        bg: editorBg,
                        style: StyleFlags.Italic,
                    });
                    continue;
                }
                const zoneDecoration = zoneDecorationByAnchor.get(zoneRow.anchor);
                const zoneLine = zoneDecoration?.lines?.[zoneRow.offset];
                const zoneFg =
                    zoneLine?.colorToken !== undefined
                        ? this.styleVar(zoneLine.colorToken)
                        : zoneDecoration?.colorToken !== undefined
                          ? this.styleVar(zoneDecoration.colorToken)
                          : editorFg;
                // Fill and text on top are two setCell calls per cell, so the zone bg is composited once.
                const zoneBg =
                    zoneLine?.bgToken !== undefined
                        ? compositeOver(this.styleVar(zoneLine.bgToken), editorBg)
                        : editorBg;
                const fill = zoneLine !== undefined ? " " : (zoneDecoration?.fillChar ?? " ");
                for (let x = 0; x < contentCols; x++) {
                    context.setCell(gutterW + x, screenY, { char: fill, fg: zoneFg, bg: zoneBg });
                }
                const text = zoneLine !== undefined ? zoneLine.text : zoneDecoration?.text;
                if (text !== undefined) {
                    context.drawText(gutterW, screenY, text.slice(0, Math.max(0, contentCols)), {
                        fg: zoneFg,
                        bg: zoneBg,
                    });
                }
                continue;
            }

            // A wrapped continuation row does not repeat the line number, chevron and markers.
            const frag = this.viewState.viewLineRange(viewLine);
            const isContinuation = frag.start > 0;

            if (viewLine < viewLineCount) {
                const logLine = this.viewState.visualToLogicalLine(viewLine);
                const lineNumStr = isContinuation
                    ? // Stryker disable next-line StringLiteral: an empty string yields an undefined char, which setCell paints as the same space
                      " ".repeat(digitCount)
                    : String(logLine + 1).padStart(digitCount, " ");
                const isActive = logLine === primaryLine;
                const numFg = isActive ? lnActiveFg : lnFg;
                const rowGutBg = lineBgByLine.get(logLine) ?? gutBg;

                for (let x = 0; x < GUTTER_LEFT_PADDING; x++) {
                    context.setCell(x, screenY, { char: " ", fg: numFg, bg: rowGutBg });
                }
                for (let d = 0; d < digitCount; d++) {
                    context.setCell(GUTTER_LEFT_PADDING + d, screenY, { char: lineNumStr[d], fg: numFg, bg: rowGutBg });
                }
                const foldCol = this.foldControlColumn;
                for (let x = GUTTER_LEFT_PADDING + digitCount; x < gutterW; x++) {
                    context.setCell(x, screenY, { char: " ", fg: numFg, bg: rowGutBg });
                }
                // The column guard and the marker map come from one source
                // (decorations.gutterMarkers), so guard mutants cannot be killed.
                // Stryker disable next-line ConditionalExpression,EqualityOperator: see above
                if (this.gutterMarkerColumns > 0 && !isContinuation) {
                    const marker = gutterMarkerByLine.get(logLine);
                    if (marker !== undefined) {
                        context.setCell(GUTTER_LEFT_PADDING + digitCount, screenY, {
                            char: marker,
                            fg: editorFg,
                            bg: rowGutBg,
                        });
                    }
                }
                // After filling the fold column, otherwise the fill erases the bar.
                const change = gutterChangeByLine.get(logLine);
                if (change !== undefined && !isContinuation) {
                    const char = change.dashed ? GUTTER_CHANGE_BAR_DASHED : GUTTER_CHANGE_BAR;
                    context.setCell(foldCol - 1, screenY, { char, fg: change.color, bg: rowGutBg });
                }
                const foldState = isContinuation ? undefined : foldHeaderByLine.get(logLine);
                const showChevron = foldState === true || (foldState === false && this.foldGutterHovered);
                if (showChevron) {
                    const icon = iconGlyph(foldState ? FOLD_ICON_COLLAPSED : FOLD_ICON_EXPANDED, this.nerdFont);
                    context.setCell(foldCol, screenY, { char: icon, fg: foldFg, bg: rowGutBg });
                }
            } else {
                for (let x = 0; x < gutterW; x++) {
                    context.setCell(x, screenY, { char: " ", bg: gutBg });
                }
            }

            if (viewLine >= viewLineCount) {
                // VS Code draws no vim tildes past the end of the document.
                for (let x = 0; x < contentCols; x++) {
                    context.setCell(gutterW + x, screenY, { char: " ", fg: editorFg, bg: editorBg });
                }
                continue;
            }

            const lineContent = this.viewState.getViewLine(viewLine);
            const rowLogLine = this.viewState.visualToLogicalLine(viewLine);
            // The cache is pure memoization, its mutants cannot be killed.
            // Stryker disable next-line CallExpression: see above
            let dl = dlByDocLine.get(rowLogLine);
            // Stryker disable next-line ConditionalExpression: see above
            if (dl === undefined) {
                // Suggestion tabs and wide characters take columns counted from the line START, like text.
                dl = this.viewState.displayLineFor(composedLineContent(phantom, rowLogLine, lineContent));
                // Stryker disable next-line CallExpression: cache fill, does not change the result
                dlByDocLine.set(rowLogLine, dl);
            }
            const lineTokens = this.viewState.getViewLineTokens(viewLine);
            const tokenIndex = lineTokens ? new TokenIndex(lineTokens, lineContent.length) : null;
            const semanticLine = this.viewState.getViewLineSemanticTokens(viewLine);
            const semanticIndex = semanticLine ? new SemanticTokenIndex(semanticLine, lookupSemanticStyle) : null;
            const isLastFragment = frag.end === lineContent.length;
            const fragStartCol = isContinuation
                ? dl.offsetToColumn(composedOffset(phantom, rowLogLine, frag.start))
                : 0;

            // A decorated line background wins over the token background, otherwise the
            // added/removed strip breaks on highlighted words.
            const decoratedBg = lineBgByLine.get(rowLogLine);
            paintTextLine(context, {
                displayLine: dl,
                tokenIndex,
                semanticIndex,
                resolveStyle,
                screenY,
                gutterW,
                contentCols,
                scrollLeft,
                startColumn: fragStartCol,
                endColumnExclusive: dl.offsetToColumn(composedOffset(phantom, rowLogLine, frag.end)),
                fg: editorFg,
                bg: decoratedBg ?? editorBg,
                allowTokenBg: decoratedBg === undefined,
                phantom:
                    phantom !== null && phantom.line === rowLogLine
                        ? {
                              startOffset: phantom.offset,
                              length: phantom.text.length,
                              fg: ghostFg,
                              style: StyleFlags.Italic,
                          }
                        : null,
            });

            // Under wrap the truncated-line badge goes on the last fragment, where the cut is.
            if (dl.isTruncated && isLastFragment) {
                let badgeStartCol = dl.displayWidth - scrollLeft - fragStartCol;
                // Under wrap there is no horizontal scroll, and a hard cut puts the cut point exactly
                // at the fragment width, so pull the badge into the visible area.
                if (this.viewState.isWordWrapActive) {
                    badgeStartCol = Math.min(badgeStartCol, contentCols - LONG_LINE_TRUNCATION_BADGE.length);
                }
                for (let i = 0; i < LONG_LINE_TRUNCATION_BADGE.length; i++) {
                    const col = badgeStartCol + i;
                    if (col >= 0 && col < contentCols) {
                        context.setCell(gutterW + col, screenY, {
                            char: LONG_LINE_TRUNCATION_BADGE[i],
                            fg: editorBg,
                            bg: this.styleVar("editorWarning.foreground"),
                        });
                    }
                }
            }

            if (foldHeaderByLine.get(rowLogLine) === true && isLastFragment) {
                const markerCol = dl.displayWidth + 1 - scrollLeft - fragStartCol;
                if (markerCol >= 0 && markerCol < contentCols) {
                    context.setCell(gutterW + markerCol, screenY, {
                        char: FOLD_COLLAPSED_MARKER,
                        fg: foldFg,
                        bg: editorBg,
                    });
                }
            }
        }

        const geometry: ITextViewportGeometry = {
            scrollTop,
            scrollLeft,
            visibleLines,
            viewLineCount,
            contentCols,
            gutterW,
            phantom,
            rows: buildViewportRows(this.viewState, scrollTop, visibleLines, phantom),
        };

        // Guides go before highlight passes: those set only `bg` and lie over the glyph.
        const indentGuideCells = this.paintIndentGuides(context, geometry, editorBg, primaryLine);

        // Pass order is stacking order: each pass wins over the previous one.
        for (const decoration of this.decorations.rangeBackgrounds ?? []) {
            paintRangeBackground(context, decoration.range, this.styleVar(decoration.colorToken), geometry);
        }

        const occurrenceBg = this.styleVar("editor.wordHighlightBackground");
        paintSortedRangeBackgrounds(context, this.getOccurrenceHighlights(), occurrenceBg, geometry);

        const searchMatches = this.viewState.searchMatches;
        const currentMatchIndex = this.viewState.currentSearchMatchIndex;
        paintSortedRangeBackgrounds(context, searchMatches, FIND_MATCH_BG, geometry, currentMatchIndex);

        // The selection color keeps its alpha: the bg patch lands on the already painted line background.
        const selectionBg = this.styleVar("editor.selectionBackground");
        for (const sel of this.viewState.selections) {
            if (isSelectionCollapsed(sel)) continue;
            paintRangeBackground(context, selectionToRange(sel), selectionBg, geometry);
        }

        if (currentMatchIndex >= 0 && currentMatchIndex < searchMatches.length) {
            paintRangeBackground(context, searchMatches[currentMatchIndex], FIND_MATCH_CURRENT_BG, geometry);
        }

        // Squiggles go after backgrounds so their color and undercurl win.
        for (const decoration of this.markerDecorations) {
            this.paintMarkerDecoration(context, decoration, geometry, indentGuideCells);
        }

        // Cell cursors only in multi-cursor, and all of them including the primary: `gridToSvg`
        // ignores the hardware cursor, so a demo frame would show a hole where the primary is.
        if (this.isFocused && this.viewState.selections.length > 1) {
            paintCarets(
                context,
                this.viewState,
                this.viewState.selections,
                {
                    fg: this.styleVar("editorCursor.background"),
                    bg: this.styleVar("editorCursor.foreground"),
                },
                geometry,
            );
        }

        const caret = caretLocalCell(this.viewState, gutterW, this.layoutSize, phantom);
        if (this.isFocused && caret !== null) {
            context.setCursorPosition(caret.x, caret.y);
        }

        // After the frame, never in it: on a big file the query walks every line.
        if (this.occurrenceRunRequested) {
            this.occurrenceRunRequested = false;
            clearTimeout(this.occurrenceTimer);
            this.occurrenceTimer = setTimeout(() => {
                this.runOccurrences();
            }, OCCURRENCE_RUN_DELAY_MS);
        }
    }

    /**
     * A guide lands only on a body line's leading whitespace: for extension regions
     * (`#region`) the marker sits at the same indent as the code, so each cell is checked
     * against the line's own indent.
     */
    private paintIndentGuides(
        context: RenderContext,
        geo: ITextViewportGeometry,
        editorBg: number,
        primaryLine: number,
    ): IndentGuideCells {
        const regions = this.viewState.foldedRegions;
        // Stryker disable next-line ConditionalExpression,EqualityOperator: the early exit
        // on an empty region list is equivalent to the pass: the loop below makes no
        // iterations and returns an empty set.
        if (regions.length === 0) return NO_GUIDE_CELLS;

        const doc = this.viewState.document;
        const tabSize = this.tabSize;

        // Logical lines grow with screenY: the first is the minimum, the last the maximum.
        const screenYByLogical = new Map<number, number>();
        let minLog = -1;
        let maxLog = -1;
        for (let screenY = 0; screenY < geo.visibleLines; screenY++) {
            const viewLine = geo.scrollTop + screenY;
            if (viewLine >= geo.viewLineCount) break;
            const logLine = this.viewState.visualToLogicalLine(viewLine);
            // View zone row: the -1 sentinel would break both the map and min/max.
            if (logLine < 0) continue;
            // Wrapped continuations start at column 0 (no wrappingIndent yet), so a guide would land on text.
            if (this.viewState.viewLineRange(viewLine).start > 0) continue;
            screenYByLogical.set(logLine, screenY);
            if (minLog < 0) minLog = logLine;
            maxLog = logLine;
        }
        // Stryker disable next-line ConditionalExpression,EqualityOperator: the early exit
        // on "no visible lines" is equivalent to the pass: with maxLog ≤ 0 every region's
        // firstBody (≥ startLine + 1) exceeds lastBody, and the loop below paints nothing.
        if (maxLog < 0) return NO_GUIDE_CELLS;

        // Regions are sorted by startLine and strictly nested: the last enclosing one is the innermost.
        let activeRegion: IFoldingRegion | null = null;
        for (const region of regions) {
            if (region.startLine <= primaryLine && primaryLine <= region.endLine) {
                activeRegion = region;
            }
        }

        const guideCells = new Map<number, Set<number>>();
        const guideFg = this.styleVar("editorIndentGuide.background1");
        const activeFg = this.styleVar("editorIndentGuide.activeBackground1");

        for (const region of regions) {
            if (region.isCollapsed) continue;
            const firstBody = Math.max(region.startLine + 1, minLog);
            const lastBody = Math.min(region.endLine, maxLog);
            if (firstBody > lastBody) continue;

            const col = computeIndentLevel(doc.getLineContent(region.startLine), tabSize);
            const screenX = geo.gutterW + col - geo.scrollLeft;
            if (screenX < geo.gutterW || screenX >= geo.gutterW + geo.contentCols) continue;

            const fg = region === activeRegion ? activeFg : guideFg;
            for (let logLine = firstBody; logLine <= lastBody; logLine++) {
                const screenY = screenYByLogical.get(logLine);
                if (screenY === undefined) continue;
                // Blank lines (-1) carry the guide through, as in VS Code.
                const bodyIndent = computeIndentLevel(doc.getLineContent(logLine), tabSize);
                if (bodyIndent !== -1 && bodyIndent <= col) continue;
                context.setCell(screenX, screenY, { char: INDENT_GUIDE, fg, bg: editorBg });
                const columns = guideCells.get(screenY);
                // Nested regions give several guides per row: add, don't replace.
                if (columns === undefined) guideCells.set(screenY, new Set([screenX]));
                else columns.add(screenX);
            }
        }

        return guideCells;
    }

    /**
     * `bg` is left alone so the highlight under the squiggle survives. On guide cells only
     * the squiggle is set: a terminal cell has one fg, and recoloring would turn `│` into a solid
     * red strip along the indent (VS Code paints the guide and the squiggle in separate layers).
     */
    private paintMarkerDecoration(
        context: RenderContext,
        decoration: IMarkerDecoration,
        geo: ITextViewportGeometry,
        indentGuideCells: IndentGuideCells,
    ): void {
        const fg = this.severityForeground(decoration.severity);
        forEachRangeCell(decoration.range, geo, (screenX, screenY) => {
            const onGuide = indentGuideCells.get(screenY)?.has(screenX) === true;
            context.setCell(
                screenX,
                screenY,
                onGuide ? { style: StyleFlags.Undercurl } : { fg, style: StyleFlags.Undercurl },
            );
        });
    }

    private severityForeground(severity: MarkerSeverity): number {
        switch (severity) {
            case MarkerSeverity.Error:
                return this.styleVar("editorError.foreground");
            case MarkerSeverity.Warning:
                return this.styleVar("editorWarning.foreground");
            case MarkerSeverity.Info:
                return this.styleVar("editorInfo.foreground");
            case MarkerSeverity.Hint:
                return this.styleVar("editorHint.foreground");
        }
    }

    private currentOccurrenceTask(): { edited: boolean; requested: boolean } {
        if (this.occurrenceTask === null) {
            // Stryker disable next-line ObjectLiteral: `{}` reads both flags as undefined, i.e. false
            this.occurrenceTask = { edited: false, requested: false };
            queueMicrotask(() => {
                this.occurrenceTask = null;
            });
        }
        return this.occurrenceTask;
    }

    /** Upstream `runDelayer.trigger`: the query is armed by the next frame, see {@link render}. */
    private requestOccurrences(): void {
        this.occurrenceRunRequested = true;
        this.markDirty();
    }

    /**
     * Like upstream `_stopAll`, a query already armed stays: it reads the caret when it runs.
     * No repaint of its own: the edit that drops it repaints anyway.
     */
    private dropOccurrences(): void {
        this.occurrences = null;
    }

    /**
     * No highlight with a selection or multi-cursor: in VS Code a selection switches to
     * selection-highlight, and with several cursors the background would clash with "select next occurrence".
     */
    private get occurrenceCaret(): IPosition | null {
        if (!this.occurrenceHighlightEnabledValue) return null;
        if (this.viewState.selections.length !== 1) return null;
        const primary = this.viewState.selections[0];
        return isSelectionCollapsed(primary) ? primary.active : null;
    }

    /** Upstream `WordHighlighter._run`: a caret still inside a highlighted word keeps the set. */
    private runOccurrences(): void {
        const pos = this.occurrenceCaret;
        // Without a caret the set stays hidden by `getOccurrenceHighlights`; an edit drops it.
        if (pos === null) return;
        if (this.occurrences !== null && sortedRangesContain(this.occurrences, pos)) return;
        this.occurrences = computeWordOccurrences(this.viewState.document, pos);
        this.markDirty();
    }

    /** Sorted by position: the painters and the scrollbar rely on it. */
    private getOccurrenceHighlights(): readonly IRange[] {
        if (this.occurrences === null || this.occurrenceCaret === null) return NO_RANGES;
        return this.occurrences;
    }

    private handleWheel(event: TUIMouseEvent): void {
        const viewState = this.viewState;
        const maxScrollTop = Math.max(0, viewState.getViewLineCount() - viewState.viewportHeight);
        const maxScrollLeft = Math.max(0, this.contentWidth - viewState.viewportWidth);

        switch (event.wheelDirection) {
            case "up":
                viewState.scrollTop = Math.max(0, viewState.scrollTop - 3);
                break;
            case "down":
                viewState.scrollTop = Math.min(maxScrollTop, viewState.scrollTop + 3);
                break;
            case "left":
                viewState.scrollLeft = Math.max(0, viewState.scrollLeft - 3);
                break;
            case "right":
                viewState.scrollLeft = Math.min(maxScrollLeft, viewState.scrollLeft + 3);
                break;
        }

        this.markDirty();
    }

    private dragAnchor: { line: number; character: number } | null = null;

    // Expanded regions show the chevron only on hover (VS Code `showFoldingControls: "mouseover"`).
    private foldGutterHovered = false;

    private setFoldGutterHovered(value: boolean): void {
        if (this.foldGutterHovered === value) return;
        this.foldGutterHovered = value;
        this.markDirty();
    }

    /** A gutter click maps to column 0. */
    public docPositionAt(localX: number, localY: number): { line: number; character: number } {
        return docPositionAt(this.viewState, this.gutterWidth, localX, localY, this.linePhantom);
    }

    private handleMouseDown(event: TUIMouseEvent): void {
        // On right click editor/contrib/contextmenu moves the cursor (or not) on the "contextmenu"
        // event, which the engine sends on release.
        if (event.button !== "left") return;
        /* v8 ignore start -- unreachable: getViewLineCount() is never 0 (document always has a line; fold headers stay visible) */
        if (this.viewState.getViewLineCount() === 0) return;
        /* v8 ignore stop */

        if (this.tryToggleFoldAtGutter(event.localX, event.localY)) {
            this.markDirty();
            return;
        }

        const pos = this.docPositionAt(event.localX, event.localY);

        // Before the shift branches: Shift+Alt+click extends the selection, not multi-cursor.
        if (event.altKey && !event.shiftKey) {
            this.dragAnchor = null; // alt+drag does not extend a selection
            this.viewState.toggleCursorAt(pos.line, pos.character);
            return;
        }

        if (event.shiftKey && this.viewState.selections.length > 0) {
            const anchor = this.viewState.selections[0].anchor;
            this.dragAnchor = { line: anchor.line, character: anchor.character };
            this.viewState.selections = [createSelection(anchor.line, anchor.character, pos.line, pos.character)];
        } else {
            this.dragAnchor = { line: pos.line, character: pos.character };
            this.viewState.selections = [createCursorSelection(pos.line, pos.character)];
        }
    }

    /** The preceding mousedown already collapsed the selection to a cursor; here it is only extended. */
    private handleDoubleClick(event: TUIMouseEvent): void {
        if (event.button !== "left") return;
        // docPositionAt would clamp the gutter to column 0 and select the line's first word.
        if (event.localX < this.gutterWidth) return;

        const pos = this.docPositionAt(event.localX, event.localY);
        const lineContent = this.viewState.document.getLineContent(pos.line);
        const word = findWordRangeAt(lineContent, pos.character);
        if (word === null) return;

        this.dragAnchor = null;
        this.viewState.selections = [createSelection(pos.line, word.start, pos.line, word.end)];
    }

    private tryToggleFoldAtGutter(localX: number, localY: number): boolean {
        if (localX !== this.foldControlColumn) return false;

        const viewLine = this.viewState.scrollTop + localY;
        if (viewLine < 0 || viewLine >= this.viewState.getViewLineCount()) return false;
        // The chevron lives on the first fragment; a click on a wrapped continuation does not fold.
        if (this.viewState.viewLineRange(viewLine).start > 0) return false;

        const logLine = this.viewState.visualToLogicalLine(viewLine);
        const region = this.viewState.foldedRegions.find((r) => r.startLine === logLine);
        if (region === undefined) return false;

        this.viewState.toggleFold(logLine);
        return true;
    }

    private handleMouseMove(event: TUIMouseEvent): void {
        this.setFoldGutterHovered(event.localX >= 0 && event.localX < this.gutterWidth);

        if (this.dragAnchor === null) return;
        /* v8 ignore start -- unreachable: getViewLineCount() is never 0 (document always has a line; fold headers stay visible) */
        if (this.viewState.getViewLineCount() === 0) return;
        /* v8 ignore stop */

        const pos = this.docPositionAt(event.localX, event.localY);
        this.viewState.selections = [
            createSelection(this.dragAnchor.line, this.dragAnchor.character, pos.line, pos.character),
        ];
    }

    private handleKeyPress(event: TUIKeyboardEvent): void {
        if (event.key === "Enter") {
            this.pushUndo(this.viewState.insertNewLine());
            return;
        }

        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
            if (!this.tryTypePaired(event.key)) this.pushUndo(this.viewState.type(event.key));
            if (this.viewState.readOnly) return;
            this.onDidTypeEmitter.fire(event.key);
            return;
        }
    }

    /**
     * One decision for all cursors: diverging contexts fall back to plain typing, which is
     * more predictable than a partial trigger (a simplification vs VS Code's per-cursor commands).
     */
    private tryTypePaired(char: string): boolean {
        const config = this.languageConfigurationSource?.();
        if (config === undefined) return false;
        const selections = this.viewState.selections;

        if (selections.every((sel) => !isSelectionCollapsed(sel))) {
            const pair = findSurroundingPair(char, config.surroundingPairs);
            if (pair === undefined) return false;
            this.pushUndo(this.viewState.surroundSelections(pair[0], pair[1]));
            return true;
        }
        if (!selections.every((sel) => isSelectionCollapsed(sel))) return false;

        const decisions = selections.map((sel) =>
            planAutoClose({
                typedChar: char,
                lineContent: this.viewState.document.getLineContent(sel.active.line),
                column: sel.active.character,
                autoClosingPairs: config.autoClosingPairs,
                autoCloseBefore: config.autoCloseBefore,
            }),
        );
        const first = decisions[0];
        if (decisions.every((d) => d.kind === "typeover")) {
            this.viewState.typeOverClosingChar();
            return true;
        }
        if (
            // Stryker disable next-line ConditionalExpression: `first` is one of `decisions`, so the
            // `every` below already checks it; here it is for the types (narrows the union to get `first.close`)
            first.kind === "autoClose" &&
            // Stryker disable next-line ConditionalExpression: comparing closers already filters out
            // non-autoClose (they lack `close`); the kind check is for the types, without it there is no `d.close`
            decisions.every((d) => d.kind === "autoClose" && d.close === first.close)
        ) {
            this.pushUndo(this.viewState.typeWithAutoClose(char, first.close));
            return true;
        }
        return false;
    }

    private handlePaste(event: TUIPasteEvent): void {
        this.pushUndo(this.viewState.insertText(event.text));
    }

    private pushUndo(element: IUndoElement | undefined): void {
        // `undefined` means no edit happened (read-only).
        if (element) {
            this.undoManager.pushUndoElement(element);
        }
    }
}
