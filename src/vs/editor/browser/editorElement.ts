import { compositeOver, packRgb } from "@tuidom/core/common/colorUtils";
import type { CursorStyle } from "@tuidom/core/common/cursorStyle";
import type { DisplayLine } from "@tuidom/core/common/displayLine";
import type { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { Point } from "@tuidom/core/common/geometryPromitives";
import { measureTextWidth } from "@tuidom/core/common/measureTextWidth";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIContextMenuEvent, TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { TUIPasteEvent } from "@tuidom/core/dom/events/tuiPasteEvent";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import type { IScrollable, IScrollBarMarker } from "@tuidom/elements/scrollbar/iScrollable";

import { findFirstIdxMonotonousOrArrLen } from "../../base/common/arraysFind.ts";
import { runWhenGlobalIdle } from "../../base/common/async.ts";
import { codicon, iconGlyph } from "../../base/common/codicons.ts";
import { Emitter } from "../../base/common/event.ts";
import type { IDisposable } from "../../base/common/lifecycle.ts";
import { firstNonWhitespaceIndex } from "../../base/common/strings.ts";
import type { IMarkerDecoration } from "../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { withCursorChangeSource } from "../common/core/cursorChangeSource.ts";
import type { IPosition } from "../common/core/iPosition.ts";
import { comparePositions } from "../common/core/iPosition.ts";
import type { IRange } from "../common/core/iRange.ts";
import { createRange } from "../common/core/iRange.ts";
import {
    createCursorSelection,
    createSelection,
    isSelectionCollapsed,
    selectionToRange,
} from "../common/core/iSelection.ts";
import { findWordRangeAt } from "../common/core/wordClassification.ts";
import { findSurroundingPair, planAutoClose } from "../common/languages/autoClosing.ts";
import type { CodeLensCommand, ICodeLensAction, ICodeLensZone } from "../common/languages/iCodeLensSource.ts";
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
import type { IExtensionTextDecoration } from "../common/model/iExtensionTextDecoration.ts";
import type { IGhostText } from "../common/model/iGhostText.ts";
import { ghostTextEquals } from "../common/model/iGhostText.ts";
import type {
    IGlyphMarginClick,
    IGlyphMarginDecoration,
    ILineHighlightDecoration,
} from "../common/model/iGlyphMarginDecoration.ts";
import type { IGutterChangeDecoration } from "../common/model/iGutterChangeDecoration.ts";
import type { IInlineInsertion } from "../common/model/iInlineInsertion.ts";
import { NO_INLINE_INSERTIONS } from "../common/model/iInlineInsertion.ts";
import type { ILineMessageClick, ILineMessageDecoration } from "../common/model/iLineMessageDecoration.ts";
import type { IOverviewRulerDecoration } from "../common/model/iOverviewRulerDecoration.ts";
import type { IUndoElement } from "../common/model/iUndoElement.ts";
import { UndoManager } from "../common/model/undoManager.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import type { LineInsertions } from "../common/viewModel/lineInsertions.ts";
import { composedFragmentStart, composedLineContent, composedOffset } from "../common/viewModel/lineInsertions.ts";
import { LineMessageLayers } from "../common/viewModel/lineMessageLayers.ts";
import { LineWidthCache } from "../common/viewModel/lineWidthCache.ts";
import {
    LONG_LINE_TRUNCATION_BADGE,
    LONG_LINE_TRUNCATION_BADGE_WIDTH,
    STOP_RENDERING_LINE_AFTER,
} from "../common/viewModel/longLineRendering.ts";
import { TrackedLineDecorations } from "../common/viewModel/trackedLineDecorations.ts";
import { computeIndentLevel } from "../contrib/folding/foldingRangeProvider.ts";
import type { IFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";
import { WordHighlighter } from "../contrib/wordHighlighter/browser/wordHighlighter.ts";

import type { IPaintTextLineInsertion, ITextViewportGeometry } from "./textViewRendering.ts";
import {
    buildViewportRows,
    caretLocalCell,
    docPositionAt,
    forEachRangeCell,
    forEachVisibleSortedRange,
    paintCarets,
    paintExtensionTextDecorationOpacity,
    paintExtensionTextDecorations,
    paintPhantomText,
    paintRangeBackground,
    paintSortedRangeBackgrounds,
    paintTextLine,
} from "./textViewRendering.ts";
import { resolveSemanticTokenStyle, SemanticTokenIndex, TokenIndex } from "./tokenIndex.ts";

const FIND_MATCH_BG = packRgb(98, 91, 23);
const FIND_MATCH_CURRENT_BG = packRgb(168, 109, 0);
const NO_CACHED_SCROLL_BAR_MARKERS: ICachedScrollBarMarkers = { sources: [], markers: [] };

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
    /** Upstream's test glyph marks its ruler in the center lane, apart from the diagnostics' right lane. */
    GlyphMargin = 7,
}
const NO_GUTTER_CHANGE_DECORATIONS: readonly IGutterChangeDecoration[] = [];
const NO_OVERVIEW_RULER_DECORATIONS: readonly IOverviewRulerDecoration[] = [];
const NO_EXTENSION_TEXT_DECORATIONS: readonly IExtensionTextDecoration[] = [];

/** The glyph a line's lane cell draws and whose owner a press on it goes to. */
interface IShownGlyph {
    readonly owner: string;
    readonly glyph: IGlyphMarginDecoration;
}
const NO_PAINT_INSERTIONS: readonly IPaintTextLineInsertion[] = [];
// In a cell grid VS Code's thin dirty-diff border becomes a bold vertical bar centered in the
// cell; modified is dashed (VS Code uses hatching).
const GUTTER_CHANGE_BAR = "┃";
const GUTTER_CHANGE_BAR_DASHED = "┋";
const GUTTER_LEFT_PADDING = 2;
/**
 * With glyphs the padding grows by a column and the glyph takes the middle one: the leftmost column lies under the
 * sash between the sidebar and the editor, which takes its clicks, and right of the glyph a gap keeps it off a
 * two-digit line number.
 */
const GUTTER_LEFT_PADDING_WITH_GLYPHS = 3;
const GLYPH_MARGIN_COLUMN = 1;

// Codicons as in VS Code: thinner than the file tree's Nerd Font fa-angle, they don't crowd the text.
const FOLD_ICON_EXPANDED = codicon("chevron-down");
const FOLD_ICON_COLLAPSED = codicon("chevron-right");
const FOLD_GAP_LEFT = 1;
const FOLD_GAP_RIGHT = 1;
const FOLD_COLLAPSED_MARKER = "⋯";
/** The element columns `[x0, x1)` of row `y` a frame painted a message on. */
interface ILineMessageCells {
    readonly y: number;
    readonly x0: number;
    readonly x1: number;
    readonly owner: string;
    readonly key: string;
}

/** Empty cells between a line's end and its message (upstream's `margin-left` of the message). */
const LINE_MESSAGE_GAP = 2;

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

interface IHoveredCodeLens {
    readonly zone: ICodeLensZone;
    readonly action: ICodeLensAction;
}

export class EditorElement extends TUIElement implements IScrollable {
    public readonly viewState: EditorViewState;
    public readonly wordHighlighter: WordHighlighter;
    /** A file editor puts the document's shared manager here: one history however many views show it. */
    public undoManager: UndoManager;
    public tokenStyleResolver: ITokenStyleResolver = NULL_TOKEN_STYLE_RESOLVER;

    public semanticTokenStyleResolver: ISemanticTokenStyleResolver = NULL_SEMANTIC_TOKEN_STYLE_RESOLVER;

    /**
     * A function, not a snapshot: the buffer language can change (Save As), and the
     * configuration can arrive later (lazy loading).
     */
    public languageConfigurationSource: (() => IResolvedLanguageConfiguration | undefined) | null = null;

    private readonly onWillTypeEmitter = new Emitter<string>();
    private readonly onDidTypeEmitter = new Emitter<string>();
    private readonly onDidChangeViewportSizeEmitter = new Emitter<void>();
    /**
     * The view state's size is plain fields written during layout: whoever asks by the visible lines listens here. A
     * width change counts only under wrap, where it moves the rows.
     */
    public readonly onDidChangeViewportSize = this.onDidChangeViewportSizeEmitter.event;
    private readonly onDidClickCodeLensEmitter = new Emitter<CodeLensCommand>();
    /** A left click on the title of a code lens. */
    public readonly onDidClickCodeLens = this.onDidClickCodeLensEmitter.event;
    private readonly onDidClickGlyphMarginEmitter = new Emitter<IGlyphMarginClick>();
    /** A press of any button on the glyph lane of a document line, with its glyph or without one; the cursor stays. */
    public readonly onDidClickGlyphMargin = this.onDidClickGlyphMarginEmitter.event;
    private readonly onDidClickLineMessageEmitter = new Emitter<ILineMessageClick>();
    /** A press of the left button on a message after a line's end: its key; the cursor stays. */
    public readonly onDidClickLineMessage = this.onDidClickLineMessageEmitter.event;
    private readonly onDidClickDocumentLinkEmitter = new Emitter<IPosition>();
    /** Ctrl+click: the press and the release on one link. The position is the link's start. */
    public readonly onDidClickDocumentLink = this.onDidClickDocumentLinkEmitter.event;

    /**
     * Upstream `ICodeEditor.onDidType`: fires AFTER the edit, including auto-close, typeover
     * and auto-surround. Paste, Enter, undo and extension edits are not typing; subscribers
     * (popup trigger characters) need typing specifically.
     */
    public readonly onDidType = this.onDidTypeEmitter.event;

    /**
     * Upstream `ICodeEditor.onWillType`: a typed character (Enter too) BEFORE its edit. The suggest popup accepts its
     * item on a commit character here, so the character lands after the inserted text.
     */
    public readonly onWillType = this.onWillTypeEmitter.event;

    private readonly onDidTypeNewLineEmitter = new Emitter<void>();
    /** Enter, after the edit. Apart from {@link onDidType}: a popup has no business with it, format on type has. */
    public readonly onDidTypeNewLine = this.onDidTypeNewLineEmitter.event;

    public get tabSize(): number {
        return this.viewState.tabSize;
    }

    public set tabSize(value: number) {
        this.viewState.tabSize = value;
    }

    public get occurrenceHighlightEnabled(): boolean {
        return this.wordHighlighter.enabled;
    }

    public set occurrenceHighlightEnabled(enabled: boolean) {
        this.wordHighlighter.enabled = enabled;
        this.markDirty();
    }

    /**
     * `null` means the editor's own background: a theme may pin `editorGutter.background` to
     * `editor.background`, and an editor with its own background (Output) would get a foreign gutter strip.
     */
    public gutterBackgroundToken: string | null = "editorGutter.background";
    /** `diode.icons.nerdFont`: Nerd Font or plain Unicode folding chevrons. */
    public nerdFont = true;
    /** `editor.cursorStyle` as a terminal cursor; `null` — the terminal's own shape. */
    public cursorStyle: CursorStyle | null = null;

    /** Stored by the document: ranges move with the text on edits. */
    public get markerDecorations(): readonly IMarkerDecoration[] {
        return this.viewState.getMarkerDecorations();
    }

    public set markerDecorations(decorations: readonly IMarkerDecoration[]) {
        this.viewState.setMarkerDecorations(decorations);
    }

    public gutterChangeDecorations: readonly IGutterChangeDecoration[] = NO_GUTTER_CHANGE_DECORATIONS;
    /** Scrollbar marks of extension decoration types (`overviewRulerColor`): the gutter has no part in them. */
    public overviewRulerDecorations: readonly IOverviewRulerDecoration[] = NO_OVERVIEW_RULER_DECORATIONS;
    /** Painted over the selection, under the current find match: upstream's decorations layer lies above selections. */
    public extensionTextDecorations: readonly IExtensionTextDecoration[] = NO_EXTENSION_TEXT_DECORATIONS;
    public decorations: IExternalDecorations = EMPTY_EXTERNAL_DECORATIONS;
    /** The glyph lane's layers by owner, in the order the owners first set glyphs. */
    private readonly glyphLayers = new Map<string, TrackedLineDecorations<IGlyphMarginDecoration>>();
    private glyphMarginReservedValue = false;
    private readonly lineHighlights: TrackedLineDecorations<ILineHighlightDecoration>;
    private readonly lineMessages: LineMessageLayers;
    /** The cells the last frame painted each message on: a click is matched against what the user saw. */
    private lineMessageCells: readonly ILineMessageCells[] = [];

    private lineWidthCache: LineWidthCache | null = null;
    /**
     * The large-file mode has no {@link LineWidthCache}: its array of one number per line and the idle sweep over
     * the file are what the mode avoids (for a document on disk the sweep would read the whole file). Like
     * upstream `ViewLines._maxLineWidth`, the width is the widest line painted so far.
     */
    private largeFileMaxWidth = 0;
    /** The pending idle slice of the width sweep ({@link runWidthSweep}); null while none is scheduled. */
    private widthSweep: IDisposable | null = null;
    private occurrenceTextMarkers = NO_CACHED_SCROLL_BAR_MARKERS;
    private occurrenceReadMarkers = NO_CACHED_SCROLL_BAR_MARKERS;
    private occurrenceWriteMarkers = NO_CACHED_SCROLL_BAR_MARKERS;
    private findMarkers = NO_CACHED_SCROLL_BAR_MARKERS;
    private scrollBarMarkers: {
        readonly occurrenceText: readonly IScrollBarMarker[];
        readonly occurrenceRead: readonly IScrollBarMarker[];
        readonly occurrenceWrite: readonly IScrollBarMarker[];
        readonly find: readonly IScrollBarMarker[];
        readonly small: readonly IScrollBarMarker[];
        readonly markers: readonly IScrollBarMarker[];
    } | null = null;
    private ghostTextValue: IGhostText | null = null;
    // Stryker disable next-line ArrayDeclaration: a garbage zone has no line, so it is never visible and has no rows
    private codeLensZones: readonly ICodeLensZone[] = [];
    /** The zones that have rows now, by anchor. */
    private codeLensByAnchor: ReadonlyMap<number, ICodeLensZone> = new Map();
    private codeLensFoldVersion = 0;
    private inlineInsertionsValue: readonly IInlineInsertion[] = NO_INLINE_INSERTIONS;
    private renderedDocLines: { first: number; last: number } | undefined;

    public get ghostText(): IGhostText | null {
        return this.ghostTextValue;
    }

    /**
     * The element puts the suggestion's tail (lines after the first) into its own set of view zones; other
     * owners' zones stay. The tail takes the first rows of a merged anchor: it hangs right under its line.
     */
    public setGhostText(ghost: IGhostText | null): void {
        if (ghostTextEquals(this.ghostTextValue, ghost)) return;
        this.ghostTextValue = ghost;
        const needsZones = ghost !== null && ghost.lines.length > 1;
        // Stryker disable ArrayDeclaration,StringLiteral: a garbage zone has no size and drops; the owner is only a distinct key
        this.viewState.setViewZones(
            needsZones ? [{ afterLine: ghost.line, size: ghost.lines.length - 1 }] : [],
            "ghostText",
        );
        // Stryker restore ArrayDeclaration,StringLiteral
        this.syncInlineInsertions();
    }

    /** How many rows at `anchor` belong to the suggestion's tail. */
    private ghostZoneRows(anchor: number): number {
        const ghost = this.ghostTextValue;
        return ghost !== null && ghost.line === anchor ? ghost.lines.length - 1 : 0;
    }

    /** One zone row above each line that has lenses and is not folded away. */
    public setCodeLensZones(zones: readonly ICodeLensZone[]): void {
        // Saves a repaint on each edit of a file without lenses: the sync below would set the same zones.
        // Stryker disable next-line ConditionalExpression: see above
        if (zones.length === 0 && this.codeLensZones.length === 0) return;
        this.codeLensZones = zones;
        this.syncCodeLensZones();
        this.markDirty();
    }

    private syncCodeLensZones(): void {
        const viewState = this.viewState;
        this.codeLensFoldVersion = viewState.foldStateVersion;
        const visible = this.codeLensZones.filter((zone) => viewState.isLineVisible(zone.line));
        this.codeLensByAnchor = new Map(visible.map((zone) => [zone.line - 1, zone]));

        // Upstream `StableEditorScrollState`: zones arriving above the viewport don't move the text under the
        // user. Scrolled to the very top, the viewport stays there: a lens of the first line is shown.
        const { scrollTop } = viewState;
        const topLine = viewState.docLineForViewLine(scrollTop);
        const rowsIntoTopLine = scrollTop - viewState.viewLineForPosition(topLine, 0);
        viewState.setViewZones(
            visible.map((zone) => ({ afterLine: zone.line - 1, size: 1 })),
            // Stryker disable next-line StringLiteral: the owner is only a distinct key
            "codeLens",
        );
        if (scrollTop > 0) {
            viewState.scrollTop = viewState.viewLineForPosition(topLine, 0) + rowsIntoTopLine;
        }
        // The hovered command may be gone with the old zones, or another one came under the pointer.
        this.updateHoveredCodeLens();
    }

    /** The lens zone under a row of the element; `undefined` for the rows of a document line or of another owner. */
    private codeLensZoneAtRow(localY: number): ICodeLensZone | undefined {
        const row = this.viewState.zoneRowForViewLine(this.viewState.scrollTop + localY);
        if (row === null || row.offset < this.ghostZoneRows(row.anchor)) return undefined;
        return this.codeLensByAnchor.get(row.anchor);
    }

    /** The text as painted: indented to the first non-whitespace column of its line, in spaces. */
    private codeLensLayout(zone: ICodeLensZone): { readonly displayLine: DisplayLine; readonly indent: number } {
        const viewState = this.viewState;
        const content = viewState.document.getLineContent(zone.line);
        // -1 for a line of whitespace only: no indent, as upstream.
        const first = Math.max(firstNonWhitespaceIndex(content), 0);
        const indent = viewState.displayLineFor(content.slice(0, first)).displayWidth;
        return { displayLine: viewState.displayLineFor(" ".repeat(indent) + zone.text), indent };
    }

    /** The columns of the row an action takes, as painted: `[start, end)` before `scrollLeft`. */
    private codeLensActionColumns(
        zone: ICodeLensZone,
        action: ICodeLensAction,
    ): { readonly start: number; readonly end: number } {
        const { displayLine, indent } = this.codeLensLayout(zone);
        return {
            start: displayLine.offsetToColumn(indent + action.start),
            end: displayLine.offsetToColumn(indent + action.end),
        };
    }

    /** The command under a cell of the zone row; not the separator or the empty part of the row. */
    private codeLensActionAt(zone: ICodeLensZone, localX: number): ICodeLensAction | undefined {
        const column = localX - this.gutterWidth + this.viewState.scrollLeft;
        return zone.actions.find((action) => {
            const { start, end } = this.codeLensActionColumns(zone, action);
            return column >= start && column < end;
        });
    }

    /** Upstream `.codelens-decoration > a:hover`: the link color and the hand, only for a lens with a command. */
    private hoveredCodeLens: IHoveredCodeLens | null = null;

    private setHoveredCodeLens(hovered: IHoveredCodeLens | null): void {
        // Saves a repaint per mouse move: the same command paints the same. New zones bring new actions.
        // Stryker disable next-line ConditionalExpression,EqualityOperator,OptionalChaining: see above
        if (this.hoveredCodeLens?.action === hovered?.action) return;
        this.hoveredCodeLens = hovered;
        this.pointerShape = hovered === null ? null : "pointer";
        this.markDirty();
    }

    /** The last cell of the pointer over the element, `null` once it left. */
    private pointerCell: { readonly x: number; readonly y: number } | null = null;

    /** By the position, not by the zone: scroll, edits and new zones move the text under a still pointer. */
    private updateHoveredCodeLens(): void {
        const pointer = this.pointerCell;
        if (pointer === null || pointer.x < this.gutterWidth) {
            this.setHoveredCodeLens(null);
            return;
        }
        const zone = this.codeLensZoneAtRow(pointer.y);
        if (zone === undefined) {
            this.setHoveredCodeLens(null);
            return;
        }
        const action = this.codeLensActionAt(zone, pointer.x);
        this.setHoveredCodeLens(action === undefined ? null : { zone, action });
    }

    private clickCodeLens(zone: ICodeLensZone, localX: number): void {
        this.dragAnchor = null;
        const action = this.codeLensActionAt(zone, localX);
        if (action !== undefined) {
            this.onDidClickCodeLensEmitter.fire(action.command);
            return;
        }
        // The separator or the empty part of the row: goes to the line, which may be just below the viewport.
        const content = this.viewState.document.getLineContent(zone.line);
        this.viewState.goToPosition(zone.line, Math.max(0, firstNonWhitespaceIndex(content)));
    }

    public get inlineInsertions(): readonly IInlineInsertion[] {
        return this.inlineInsertionsValue;
    }

    /** By position and not overlapping (`LinkDetector`). */
    public setDocumentLinks(ranges: readonly IRange[]): void {
        this.documentLinks = ranges;
        this.activeDocumentLink = null;
        this.pressedDocumentLink = null;
        this.markDirty();
    }

    /** Insertions of the owner (color decorators); ghost text has its own, both are drawn. */
    public setInlineInsertions(insertions: readonly IInlineInsertion[]): void {
        this.inlineInsertionsValue = insertions;
        this.syncInlineInsertions();
    }

    /** The suggestion's first line is one more insertion, first among those at its offset: it sits at the caret. */
    private syncInlineInsertions(): void {
        const ghost = this.ghostTextValue;
        this.viewState.inlineInsertions =
            ghost === null
                ? this.inlineInsertionsValue
                : [
                      {
                          line: ghost.line,
                          offset: ghost.character,
                          text: ghost.lines[0],
                          colorToken: "editorGhostText.foreground",
                          // Like VS Code ghost text (`.ghost-text-decoration`).
                          italic: true,
                      },
                      ...this.inlineInsertionsValue,
                  ];
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
        const occurrences = vs.wordHighlights;
        const searchMatches = vs.searchMatches;
        this.occurrenceTextMarkers = this.rangeMarkers(
            this.occurrenceTextMarkers,
            occurrences.text,
            "editorOverviewRuler.wordHighlightTextForeground",
            ScrollBarMarkerPriority.WordHighlight,
            projection,
        );
        this.occurrenceReadMarkers = this.rangeMarkers(
            this.occurrenceReadMarkers,
            occurrences.read,
            "editorOverviewRuler.wordHighlightForeground",
            ScrollBarMarkerPriority.WordHighlight,
            projection,
        );
        this.occurrenceWriteMarkers = this.rangeMarkers(
            this.occurrenceWriteMarkers,
            occurrences.write,
            "editorOverviewRuler.wordHighlightStrongForeground",
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
        // Extension types' `overviewRulerColor` marks share the SCM bars' rank: upstream's default lane is the center.
        const changeMarkers = [...this.gutterChangeDecorations, ...this.overviewRulerDecorations].map(
            ({ range, color }) => this.scrollBarMarker(range, color, ScrollBarMarkerPriority.GutterChange),
        );
        const diagnosticMarkers: IScrollBarMarker[] = [];
        for (const { range, severity } of this.markerDecorations) {
            // Hints have no ruler mark in VS Code either.
            if (severity === MarkerSeverity.Hint) continue;
            const lane = this.severityRulerLane(severity);
            diagnosticMarkers.push(this.scrollBarMarker(range, lane.color, lane.priority));
        }
        const glyphMarkers: IScrollBarMarker[] = [];
        // Every owner's glyph marks the ruler, also one the lane's single cell does not draw (upstream's lanes).
        for (const layer of this.glyphLayers.values()) {
            for (const [line, glyph] of layer.byLine()) {
                if (glyph.overviewRulerColorToken === undefined) continue;
                const color = this.styleVar(glyph.overviewRulerColorToken);
                glyphMarkers.push(
                    this.scrollBarMarker(createRange(line, 0, line, 0), color, ScrollBarMarkerPriority.GlyphMargin),
                );
            }
        }
        const small = [...changeMarkers, ...diagnosticMarkers, ...glyphMarkers];

        const cached = this.scrollBarMarkers;
        if (
            cached?.occurrenceText === this.occurrenceTextMarkers.markers &&
            cached.occurrenceRead === this.occurrenceReadMarkers.markers &&
            cached.occurrenceWrite === this.occurrenceWriteMarkers.markers &&
            cached.find === this.findMarkers.markers &&
            sameMarkers(cached.small, small)
        ) {
            return cached.markers;
        }
        const markers = this.occurrenceTextMarkers.markers.concat(
            this.occurrenceReadMarkers.markers,
            this.occurrenceWriteMarkers.markers,
            changeMarkers,
            this.findMarkers.markers,
            diagnosticMarkers,
            glyphMarkers,
        );
        this.scrollBarMarkers = {
            occurrenceText: this.occurrenceTextMarkers.markers,
            occurrenceRead: this.occurrenceReadMarkers.markers,
            occurrenceWrite: this.occurrenceWriteMarkers.markers,
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
        return Math.max(this.documentWidth(), this.insertionLinesWidth());
    }

    private documentWidth(): number {
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
            const width = this.lineWidth(document.getLineContent(line));
            // Stryker disable next-line EqualityOperator: storing an equal width changes nothing — equivalent
            if (width > this.largeFileMaxWidth) this.largeFileMaxWidth = width;
        }
        return this.largeFileMaxWidth;
    }

    /**
     * The width cache knows only the document: a line with insertions is measured composed, on
     * every call — such lines are few (the owner's set, not the file).
     */
    private insertionLinesWidth(): number {
        const document = this.viewState.document;
        const insertions = this.viewState.lineInsertions;
        let max = 0;
        for (const line of insertions.keys()) {
            const composed = composedLineContent(insertions, line, document.getLineContent(line));
            max = Math.max(max, this.lineWidth(composed));
        }
        return max;
    }

    private lineWidth(content: string): number {
        const width = measureTextWidth(content, this.tabSize, STOP_RENDERING_LINE_AFTER);
        return content.length > STOP_RENDERING_LINE_AFTER ? width + LONG_LINE_TRUNCATION_BADGE_WIDTH : width;
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
        return this.gutterLeftPadding + digitCount + this.gutterMarkerColumns + FOLD_GAP_LEFT + 1 + FOLD_GAP_RIGHT;
    }

    /**
     * The glyph lane exists while some glyph is set or it is reserved: an editor without either keeps its gutter as
     * it was (upstream's `editor.glyphMargin` is always on).
     */
    private get hasGlyphLane(): boolean {
        if (this.glyphMarginReservedValue) return true;
        for (const layer of this.glyphLayers.values()) if (!layer.isEmpty) return true;
        return false;
    }

    private get gutterLeftPadding(): number {
        return this.hasGlyphLane ? GUTTER_LEFT_PADDING_WITH_GLYPHS : GUTTER_LEFT_PADDING;
    }

    /** The glyph lane stays without glyphs: a press on a line's empty lane is a glyph margin click (breakpoints). */
    public get glyphMarginReserved(): boolean {
        return this.glyphMarginReservedValue;
    }

    public set glyphMarginReserved(reserved: boolean) {
        this.glyphMarginReservedValue = reserved;
        this.markDirty();
    }

    /** An owner's glyphs in the glyph lane; each keeps its line through edits until set again elsewhere. */
    public setGlyphMarginDecorations(owner: string, decorations: readonly IGlyphMarginDecoration[]): void {
        let layer = this.glyphLayers.get(owner);
        if (layer === undefined) {
            layer = new TrackedLineDecorations(this.viewState.document);
            this.glyphLayers.set(owner, layer);
        }
        layer.set(decorations);
        this.markDirty();
    }

    /** The glyph each line shows: the highest `zIndex` of the owners', a tie to the owner that came first. */
    private glyphsByLine(): Map<number, IShownGlyph> {
        const result = new Map<number, IShownGlyph>();
        for (const [owner, layer] of this.glyphLayers) {
            for (const [line, glyph] of layer.byLine()) {
                const shown = result.get(line);
                if (shown === undefined || (glyph.zIndex ?? 0) > (shown.glyph.zIndex ?? 0)) {
                    result.set(line, { owner, glyph });
                }
            }
        }
        return result;
    }

    /** The highlighted lines; each keeps its line through edits until set again elsewhere, a deleted one is gone. */
    public setLineHighlightDecorations(decorations: readonly ILineHighlightDecoration[]): void {
        this.lineHighlights.set(decorations);
        this.markDirty();
    }

    /** An owner's messages after the lines' ends; each keeps its line through edits until set again elsewhere. */
    public setLineMessageDecorations(owner: string, decorations: readonly ILineMessageDecoration[]): void {
        this.lineMessages.set(owner, decorations);
        this.markDirty();
    }

    /** The owner's messages by the line they are on now: a deleted line's message is gone. */
    public getLineMessageDecorations(owner: string): ReadonlyMap<number, ILineMessageDecoration> {
        return this.lineMessages.byLineOf(owner);
    }

    private get gutterMarkerColumns(): number {
        return (this.decorations.gutterMarkers?.length ?? 0) > 0 ? 1 : 0;
    }

    public get foldControlColumn(): number {
        return this.gutterWidth - 1 - FOLD_GAP_RIGHT;
    }

    public getCaretScreenCell(): Point | null {
        const local = caretLocalCell(this.viewState, this.gutterWidth, this.layoutSize, this.viewState.lineInsertions);
        if (local === null) return null;
        return new Point(this.globalPosition.x + local.x, this.globalPosition.y + local.y);
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
        if (this.viewState.viewportHeight !== size.height) {
            queueMicrotask(() => {
                this.onDidChangeViewportSizeEmitter.fire();
            });
        }
        this.viewState.viewportWidth = textWidth;
        this.viewState.viewportHeight = size.height;
        if (changed && this.viewState.isWordWrapActive) {
            queueMicrotask(() => {
                this.markDirty();
                // A height change under wrap fires twice in one tick: listeners coalesce (a scheduler, a compare).
                this.onDidChangeViewportSizeEmitter.fire();
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
        this.wordHighlighter = new WordHighlighter(viewState);
        this.lineHighlights = new TrackedLineDecorations(viewState.document);
        this.lineMessages = new LineMessageLayers(viewState.document);

        this.viewState.onDidChangeWordHighlights(() => {
            this.markDirty();
        });
        this.viewState.onDidChangeLinkedEditingRanges(() => {
            this.markDirty();
        });
        this.viewState.onDidChangeSnippetTabstopRanges(() => {
            this.markDirty();
        });
        this.viewState.onDidChangeCursorPosition(() => {
            this.markDirty();
        });
        // Scroll, folding and edits away from the cursor (extension applyEdits) too: under
        // damage tracking an unmarked widget is not repainted.
        this.viewState.onDidChangeView(() => {
            // A fold hides or shows the lenses of the lines inside it. The condition only saves work: syncing the
            // same state again sets the same zones, a no-op.
            // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator: see above
            if (this.codeLensZones.length > 0 && this.codeLensFoldVersion !== this.viewState.foldStateVersion) {
                this.syncCodeLensZones();
            }
            this.updateHoveredCodeLens();
            this.markDirty();
        });
        this.viewState.document.onDidChangeContent((change) => {
            if (change.isFlush === true) this.largeFileMaxWidth = 0;
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
        // Before the editor's context menu, which listens on the view around the element and skips a prevented event.
        this.addEventListener("contextmenu", (event) => {
            const menu = event as TUIContextMenuEvent;
            // A click on the lane prevents the event: the glyph's click instead of the menu.
            if (menu.trigger === "mouse") this.tryClickGlyphMargin(menu, "right");
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
        this.addEventListener("mouseup", (event) => {
            this.dragAnchor = null;
            this.releaseDocumentLink(event);
        });
        this.addEventListener("mouseleave", () => {
            this.setFoldGutterHovered(false);
            this.pointerCell = null;
            this.setHoveredCodeLens(null);
            this.pressedDocumentLink = null;
            this.setActiveDocumentLink(null);
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
        const leftPadding = this.gutterLeftPadding;
        const digitCount = gutterW - leftPadding - this.gutterMarkerColumns - FOLD_GAP_LEFT - 1 - FOLD_GAP_RIGHT;
        const foldFg = this.styleVar("editorGutter.foldingControlForeground");
        const ghost = this.ghostTextValue;
        const ghostFg = ghost !== null ? this.styleVar("editorGhostText.foreground") : 0;
        // One value for all passes of the frame: line, range backgrounds, cursors.
        const insertions = this.viewState.lineInsertions;

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
        const glyphByLine = this.glyphsByLine();
        const highlightBgByLine = new Map<number, number>();
        for (const [line, highlight] of this.lineHighlights.byLine()) {
            highlightBgByLine.set(line, compositeOver(this.styleVar(highlight.colorToken), editorBg));
        }
        const messagesByLine = this.lineMessages.byLine();
        // Stryker disable next-line ArrayDeclaration: equivalent, an entry that is not a cell matches no click
        const messageCells: ILineMessageCells[] = [];
        this.lineMessageCells = messageCells;
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
                // Without a ghost there are no ghost rows: `ghost !== null` narrows the type for the branch.
                // Stryker disable next-line ConditionalExpression: see above
                if (ghost !== null && zoneRow.offset < this.ghostZoneRows(zoneRow.anchor)) {
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
                const lens = this.codeLensByAnchor.get(zoneRow.anchor);
                if (lens !== undefined) {
                    const lensFg = this.styleVar("editorCodeLens.foreground");
                    // The extra column of a "<=" mutant is clipped by the element rectangle.
                    // Stryker disable next-line EqualityOperator: see above
                    for (let x = 0; x < contentCols; x++) {
                        // Stryker disable next-line StringLiteral: a cell with no char reads as a space
                        context.setCell(gutterW + x, screenY, { char: " ", fg: lensFg, bg: editorBg });
                    }
                    paintPhantomText(context, {
                        displayLine: this.codeLensLayout(lens).displayLine,
                        screenY,
                        gutterW,
                        contentCols,
                        fg: lensFg,
                        bg: editorBg,
                        style: StyleFlags.None,
                        scrollLeft,
                    });
                    const hovered = this.hoveredCodeLens;
                    if (hovered?.zone === lens) {
                        const { start, end } = this.codeLensActionColumns(lens, hovered.action);
                        const fg = this.styleVar("editorLink.activeForeground");
                        // Past the right edge the element rectangle clips; on the left the gutter would take it.
                        for (let col = Math.max(start, scrollLeft); col < end; col++) {
                            context.setCell(gutterW + col - scrollLeft, screenY, { fg });
                        }
                    }
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

                for (let x = 0; x < leftPadding; x++) {
                    context.setCell(x, screenY, { char: " ", fg: numFg, bg: rowGutBg });
                }
                const glyph = isContinuation ? undefined : glyphByLine.get(logLine)?.glyph;
                if (glyph !== undefined) {
                    context.setCell(GLYPH_MARGIN_COLUMN, screenY, {
                        char: glyph.glyph,
                        fg: glyph.color ?? this.styleVar(glyph.colorToken),
                        bg: rowGutBg,
                    });
                }
                for (let d = 0; d < digitCount; d++) {
                    context.setCell(leftPadding + d, screenY, { char: lineNumStr[d], fg: numFg, bg: rowGutBg });
                }
                const foldCol = this.foldControlColumn;
                // Stryker disable next-line EqualityOperator: equivalent — the text paints the column at gutterW over it
                for (let x = leftPadding + digitCount; x < gutterW; x++) {
                    context.setCell(x, screenY, { char: " ", fg: numFg, bg: rowGutBg });
                }
                // The column guard and the marker map come from one source
                // (decorations.gutterMarkers), so guard mutants cannot be killed.
                // Stryker disable next-line ConditionalExpression,EqualityOperator: see above
                if (this.gutterMarkerColumns > 0 && !isContinuation) {
                    const marker = gutterMarkerByLine.get(logLine);
                    if (marker !== undefined) {
                        context.setCell(leftPadding + digitCount, screenY, {
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
                dl = this.viewState.displayLineFor(composedLineContent(insertions, rowLogLine, lineContent));
                // Stryker disable next-line CallExpression: cache fill, does not change the result
                dlByDocLine.set(rowLogLine, dl);
            }
            const lineTokens = this.viewState.getViewLineTokens(viewLine);
            const tokenIndex = lineTokens ? new TokenIndex(lineTokens, lineContent.length) : null;
            const semanticLine = this.viewState.getViewLineSemanticTokens(viewLine);
            const semanticIndex = semanticLine ? new SemanticTokenIndex(semanticLine, lookupSemanticStyle) : null;
            const isLastFragment = frag.end === lineContent.length;
            const fragStartCol = dl.offsetToColumn(composedFragmentStart(insertions, rowLogLine, frag.start));

            // A decorated line background wins over the token background, otherwise the
            // added/removed strip breaks on highlighted words.
            const decoratedBg = lineBgByLine.get(rowLogLine) ?? highlightBgByLine.get(rowLogLine);
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
                endColumnExclusive: dl.offsetToColumn(composedOffset(insertions, rowLogLine, frag.end)),
                fg: editorFg,
                bg: decoratedBg ?? editorBg,
                allowTokenBg: decoratedBg === undefined,
                insertions: this.paintInsertions(insertions.get(rowLogLine), editorFg, editorBg),
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

            const isFoldedHeader = foldHeaderByLine.get(rowLogLine) === true;
            if (isFoldedHeader && isLastFragment) {
                const markerCol = dl.displayWidth + 1 - scrollLeft - fragStartCol;
                if (markerCol >= 0 && markerCol < contentCols) {
                    context.setCell(gutterW + markerCol, screenY, {
                        char: FOLD_COLLAPSED_MARKER,
                        fg: foldFg,
                        bg: editorBg,
                    });
                }
            }

            const messages = isLastFragment ? messagesByLine.get(rowLogLine) : undefined;
            if (messages !== undefined) {
                // After what the line's end already shows: the cut line's badge, the folded region's marker.
                const lineEnd =
                    dl.displayWidth +
                    (dl.isTruncated ? LONG_LINE_TRUNCATION_BADGE_WIDTH : 0) +
                    (isFoldedHeader ? 1 + FOLD_COLLAPSED_MARKER.length : 0);
                let startCol = lineEnd + LINE_MESSAGE_GAP - scrollLeft - fragStartCol;
                for (const { owner, message } of messages) {
                    const cells = this.paintLineMessage(context, message, {
                        screenY,
                        gutterW,
                        contentCols,
                        startCol,
                        bg: decoratedBg ?? editorBg,
                    });
                    messageCells.push({ y: screenY, x0: cells.x0, x1: cells.x1, owner, key: message.key });
                    startCol += cells.width + LINE_MESSAGE_GAP;
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
            insertions,
            rows: buildViewportRows(this.viewState, scrollTop, visibleLines, insertions),
        };

        // Guides go before highlight passes: those set only `bg` and lie over the glyph.
        const indentGuideCells = this.paintIndentGuides(context, geometry, primaryLine);

        // Pass order is stacking order: each pass wins over the previous one.
        for (const decoration of this.decorations.rangeBackgrounds ?? []) {
            paintRangeBackground(context, decoration.range, this.styleVar(decoration.colorToken), geometry);
        }

        const occurrences = this.viewState.wordHighlights;
        this.paintOccurrences(context, occurrences.text, "editor.wordHighlightTextBackground", geometry);
        this.paintOccurrences(context, occurrences.read, "editor.wordHighlightBackground", geometry);
        this.paintOccurrences(context, occurrences.write, "editor.wordHighlightStrongBackground", geometry);
        // Over the occurrences: the same word usually carries both.
        this.paintOccurrences(context, this.viewState.linkedEditingRanges, "editor.linkedEditingBackground", geometry);
        // Upstream tells the active tab stop by its border, which a cell has none of: one background for all.
        this.paintOccurrences(
            context,
            this.viewState.snippetTabstopRanges,
            "editor.snippetTabstopHighlightBackground",
            geometry,
        );

        const searchMatches = this.viewState.searchMatches;
        const currentMatchIndex = this.viewState.currentSearchMatchIndex;
        paintSortedRangeBackgrounds(context, searchMatches, FIND_MATCH_BG, geometry, currentMatchIndex);

        // The selection color keeps its alpha: the bg patch lands on the already painted line background.
        const selectionBg = this.styleVar("editor.selectionBackground");
        for (const sel of this.viewState.selections) {
            if (isSelectionCollapsed(sel)) continue;
            paintRangeBackground(context, selectionToRange(sel), selectionBg, geometry);
        }

        paintExtensionTextDecorations(context, this.extensionTextDecorations, geometry);

        if (currentMatchIndex >= 0 && currentMatchIndex < searchMatches.length) {
            paintRangeBackground(context, searchMatches[currentMatchIndex], FIND_MATCH_CURRENT_BG, geometry);
        }
        // After every background pass: the faded text shows the background it finally lies on.
        paintExtensionTextDecorationOpacity(context, this.extensionTextDecorations, geometry);

        this.paintDocumentLinks(context, geometry);

        // Squiggles go after backgrounds so their color and undercurl win.
        for (const decoration of this.markerDecorations) {
            this.paintMarkerDecoration(context, decoration, geometry, indentGuideCells);
        }

        // Cell cursors only in multi-cursor. A block (or the terminal's shape) paints the primary too:
        // `gridToSvg` ignores the hardware cursor, so a demo frame would show a hole there. A bar or an
        // underline leaves the primary to the hardware cursor, or a block would sit under the bar.
        if (this.isFocused && this.viewState.selections.length > 1) {
            const hardwareOnlyPrimary = this.cursorStyle !== null && this.cursorStyle.shape !== "block";
            paintCarets(
                context,
                this.viewState,
                hardwareOnlyPrimary ? this.viewState.selections.slice(1) : this.viewState.selections,
                {
                    fg: this.styleVar("editorCursor.background"),
                    bg: this.styleVar("editorCursor.foreground"),
                },
                geometry,
            );
        }

        const caret = caretLocalCell(this.viewState, gutterW, this.layoutSize, insertions);
        if (this.isFocused && caret !== null) {
            context.setCursorPosition(caret.x, caret.y, this.cursorStyle);
        }

        this.wordHighlighter.onFrame();
    }

    /**
     * The message's text from `startCol` of the content area, cut by its edges; the cells it took, in element
     * columns: an empty span when none is visible, which paints nothing and no click lands in.
     */
    private paintLineMessage(
        context: RenderContext,
        message: ILineMessageDecoration,
        at: { screenY: number; gutterW: number; contentCols: number; startCol: number; bg: number },
    ): { x0: number; x1: number; width: number } {
        const { screenY, gutterW, contentCols, startCol } = at;
        const displayLine = this.viewState.displayLineFor(message.text);
        const x0 = Math.max(startCol, 0);
        const x1 = Math.min(startCol + displayLine.displayWidth, contentCols);
        const bg = message.bgToken === undefined ? at.bg : compositeOver(this.styleVar(message.bgToken), at.bg);
        paintPhantomText(context, {
            displayLine,
            screenY,
            gutterW: gutterW + x0,
            // Stryker disable next-line ArithmeticOperator: equivalent, the content area reaches the element's right edge and RenderContext clips there
            contentCols: x1 - x0,
            fg: compositeOver(this.styleVar(message.colorToken), bg),
            bg,
            style: StyleFlags.None,
            scrollLeft: x0 - startCol,
        });
        return { x0: gutterW + x0, x1: gutterW + x1, width: displayLine.displayWidth };
    }

    /** Tokens resolve only when there is something to paint: a bare element has no theme. */
    private paintOccurrences(
        context: RenderContext,
        ranges: readonly IRange[],
        colorToken: string,
        geometry: ITextViewportGeometry,
    ): void {
        if (ranges.length === 0) return;
        paintSortedRangeBackgrounds(context, ranges, this.styleVar(colorToken), geometry);
    }

    /** The underline joins what the token set (bold, italic); the active link also takes its color. */
    private paintDocumentLinks(context: RenderContext, geometry: ITextViewportGeometry): void {
        const active = this.activeDocumentLink;
        forEachVisibleSortedRange(this.documentLinks, geometry, (range) => {
            const fg = active === range ? this.styleVar("editorLink.activeForeground") : undefined;
            forEachRangeCell(range, geometry, (screenX, screenY) => {
                const cell = context.getCell(screenX, screenY);
                if (cell === null) return;
                context.setCell(screenX, screenY, { fg, style: cell.style | StyleFlags.Underline });
            });
        });
    }

    /** Colors are resolved here, on the frame: hit-test and the caret need none. */
    private paintInsertions(
        insertions: readonly IInlineInsertion[] | undefined,
        editorFg: number,
        editorBg: number,
    ): readonly IPaintTextLineInsertion[] {
        if (insertions === undefined) return NO_PAINT_INSERTIONS;
        return insertions.map((insertion) => ({
            offset: insertion.offset,
            length: insertion.text.length,
            fg: insertion.fg ?? (insertion.colorToken !== undefined ? this.styleVar(insertion.colorToken) : editorFg),
            // Composited once, here, like the line backgrounds: the frame paints a line in several passes.
            bg: this.insertionBg(insertion, editorBg),
            style:
                (insertion.italic === true ? StyleFlags.Italic : StyleFlags.None) |
                (insertion.dim === true ? StyleFlags.Dim : StyleFlags.None) |
                (insertion.style ?? StyleFlags.None),
        }));
    }

    private insertionBg(insertion: IInlineInsertion, editorBg: number): number | undefined {
        if (insertion.bg !== undefined) return compositeOver(insertion.bg, editorBg);
        return insertion.bgToken !== undefined ? compositeOver(this.styleVar(insertion.bgToken), editorBg) : undefined;
    }

    /**
     * A guide lands only on a body line's leading whitespace: for extension regions
     * (`#region`) the marker sits at the same indent as the code, so each cell is checked
     * against the line's own indent.
     */
    private paintIndentGuides(
        context: RenderContext,
        geo: ITextViewportGeometry,
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

            const fg = region === activeRegion ? activeFg : guideFg;
            for (let logLine = firstBody; logLine <= lastBody; logLine++) {
                const screenY = screenYByLogical.get(logLine);
                if (screenY === undefined) continue;
                // Blank lines (-1) carry the guide through, as in VS Code.
                const bodyIndent = computeIndentLevel(doc.getLineContent(logLine), tabSize);
                if (bodyIndent !== -1 && bodyIndent <= col) continue;
                const screenX =
                    geo.gutterW + col + this.insertionShiftAt(geo.insertions, logLine, col) - geo.scrollLeft;
                if (screenX < geo.gutterW) continue;
                // Stryker disable next-line ConditionalExpression,EqualityOperator: the render context clips at the element's right edge, a guide past it is not drawn either way
                if (screenX >= geo.gutterW + geo.contentCols) continue;
                // No `bg`: the guide keeps the row's background, a diff strip's or a stack frame's highlight too.
                context.setCell(screenX, screenY, { char: INDENT_GUIDE, fg });
                const columns = guideCells.get(screenY);
                // Nested regions give several guides per row: add, don't replace.
                if (columns === undefined) guideCells.set(screenY, new Set([screenX]));
                else columns.add(screenX);
            }
        }

        return guideCells;
    }

    /**
     * How far the insertions push display column `col` of a line right: the guide stands on the
     * same whitespace character of the composed line. Past the end of a blank line all of them do.
     */
    private insertionShiftAt(insertions: LineInsertions, line: number, col: number): number {
        // Stryker disable next-line ConditionalExpression: a shortcut, with no insertions the composed line is the document line and the shift is 0
        if (!insertions.has(line)) return 0;
        const content = this.viewState.document.getLineContent(line);
        const documentLine = this.viewState.displayLineFor(content);
        const offset = documentLine.columnToOffset(col);
        const composedLine = this.viewState.displayLineFor(composedLineContent(insertions, line, content));
        return (
            composedLine.offsetToColumn(composedOffset(insertions, line, offset)) - documentLine.offsetToColumn(offset)
        );
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

    /**
     * Scrolls to the offset (view rows and columns), clamped to the content. `ScrollBarDecorator`
     * drives the editor through it: a press on its track, a drag of its thumb.
     */
    public scrollTo(left: number, top: number): void {
        const viewState = this.viewState;
        const maxScrollTop = Math.max(0, viewState.getViewLineCount() - viewState.viewportHeight);
        const maxScrollLeft = Math.max(0, this.contentWidth - viewState.viewportWidth);
        viewState.scrollTop = Math.min(maxScrollTop, Math.max(0, top));
        // The setters fire onDidChangeView, which marks the frame dirty.
        viewState.scrollLeft = Math.min(maxScrollLeft, Math.max(0, left));
    }

    private handleWheel(event: TUIMouseEvent): void {
        const { scrollLeft, scrollTop } = this.viewState;
        switch (event.wheelDirection) {
            case "up":
                this.scrollTo(scrollLeft, scrollTop - 3);
                break;
            case "down":
                this.scrollTo(scrollLeft, scrollTop + 3);
                break;
            case "left":
                this.scrollTo(scrollLeft - 3, scrollTop);
                break;
            case "right":
                this.scrollTo(scrollLeft + 3, scrollTop);
                break;
        }
    }

    private dragAnchor: { line: number; character: number } | null = null;

    private documentLinks: readonly IRange[] = [];
    /** Under the pointer with Ctrl held: only as far as the terminal reports modifiers on a move. */
    private activeDocumentLink: IRange | null = null;
    /** The link of a Ctrl+left press, kept for its release. */
    private pressedDocumentLink: IRange | null = null;

    // Expanded regions show the chevron only on hover (VS Code `showFoldingControls: "mouseover"`).
    private foldGutterHovered = false;

    private setFoldGutterHovered(value: boolean): void {
        if (this.foldGutterHovered === value) return;
        this.foldGutterHovered = value;
        this.markDirty();
    }

    /** A gutter click maps to column 0. */
    public docPositionAt(localX: number, localY: number): { line: number; character: number } {
        return docPositionAt(this.viewState, this.gutterWidth, localX, localY, this.viewState.lineInsertions);
    }

    private handleMouseDown(event: TUIMouseEvent): void {
        // On right click editor/contrib/contextmenu moves the cursor (or not) on the "contextmenu"
        // event, which the engine sends on release.
        if (event.button === "middle") {
            this.tryClickGlyphMargin(event, "middle");
            return;
        }
        if (event.button !== "left") return;
        /* v8 ignore start -- unreachable: getViewLineCount() is never 0 (document always has a line; fold headers stay visible) */
        if (this.viewState.getViewLineCount() === 0) return;
        /* v8 ignore stop */

        if (this.tryClickGlyphMargin(event, "left")) {
            this.dragAnchor = null;
            return;
        }

        const message = this.lineMessageCells.find(
            (cells) => cells.y === event.localY && event.localX >= cells.x0 && event.localX < cells.x1,
        );
        if (message !== undefined) {
            this.dragAnchor = null;
            this.onDidClickLineMessageEmitter.fire({ owner: message.owner, key: message.key });
            return;
        }

        if (this.tryToggleFoldAtGutter(event.localX, event.localY)) {
            this.markDirty();
            return;
        }

        const lens = this.codeLensZoneAtRow(event.localY);
        if (lens !== undefined) {
            this.clickCodeLens(lens, event.localX);
            return;
        }

        if (event.ctrlKey) {
            const link = this.documentLinkAtCell(event.localX, event.localY);
            if (link !== null) {
                // Opens on release, like the terminal's links; the caret stays.
                this.pressedDocumentLink = link;
                return;
            }
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
        // docPositionAt would take the nearest line of the document under a zone.
        if (this.viewState.viewLineKind(this.viewState.scrollTop + event.localY) === "zone") return;

        const pos = this.docPositionAt(event.localX, event.localY);
        const lineContent = this.viewState.document.getLineContent(pos.line);
        const word = findWordRangeAt(lineContent, pos.character);
        if (word === null) return;

        this.dragAnchor = null;
        this.viewState.selections = [createSelection(pos.line, word.start, pos.line, word.end)];
    }

    /**
     * The glyph lane is the whole left padding: the glyph is drawn in its middle, a press anywhere on it counts, on a
     * line without a glyph too (upstream's glyph margin never moves the cursor). From the screen cell, as the
     * editor's context menu reads its event.
     */
    private tryClickGlyphMargin(event: TUIMouseEvent, button: IGlyphMarginClick["button"]): boolean {
        if (!this.hasGlyphLane) return false;
        const localX = event.screenX - this.globalPosition.x;
        if (localX >= this.gutterLeftPadding) return false;
        const line = this.gutterLineAt(event.screenY - this.globalPosition.y);
        if (line < 0) return false;
        const shown = this.glyphsByLine().get(line);
        // A press focuses the editor first, as upstream's mouse down: what the click opens (an input) takes the focus
        // after it, not before the press's default focus. A right click's press has focused it already.
        this.focus();
        event.preventDefault();
        this.onDidClickGlyphMarginEmitter.fire({
            line,
            ...(shown === undefined ? {} : { owner: shown.owner, key: shown.glyph.key }),
            button,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            screenX: event.screenX,
            screenY: event.screenY,
        });
        return true;
    }

    private tryToggleFoldAtGutter(localX: number, localY: number): boolean {
        if (localX !== this.foldControlColumn) return false;
        const logLine = this.gutterLineAt(localY);
        const region = this.viewState.foldedRegions.find((r) => r.startLine === logLine);
        if (region === undefined) return false;

        this.viewState.toggleFold(logLine);
        return true;
    }

    /**
     * The document line whose gutter is at the row, -1 for none: the chevron and the glyph live on a line's first
     * fragment, so a wrapped continuation has none; a view zone and the rows past the end are line -1.
     */
    private gutterLineAt(localY: number): number {
        const viewLine = this.viewState.scrollTop + localY;
        if (this.viewState.viewLineRange(viewLine).start > 0) return -1;
        return this.viewState.visualToLogicalLine(viewLine);
    }

    /**
     * The link in this very cell. Unlike a caret's position, the cell right after a link is not on it, and neither
     * is the gutter, a view zone or the space past the end of the document, which `docPositionAt` clamps to text.
     */
    private documentLinkAtCell(localX: number, localY: number): IRange | null {
        if (localX < this.gutterWidth) return null;
        const viewLine = this.viewState.scrollTop + localY;
        if (viewLine >= this.viewState.getViewLineCount()) return null;
        if (this.viewState.viewLineKind(viewLine) === "zone") return null;
        const pos = this.docPositionAt(localX, localY);
        return (
            this.documentLinks.find(
                (range) => comparePositions(range.start, pos) <= 0 && comparePositions(pos, range.end) < 0,
            ) ?? null
        );
    }

    private releaseDocumentLink(event: TUIMouseEvent): void {
        const pressed = this.pressedDocumentLink;
        if (pressed === null) return;
        this.pressedDocumentLink = null;
        if (this.documentLinkAtCell(event.localX, event.localY) === pressed) {
            this.onDidClickDocumentLinkEmitter.fire(pressed.start);
        }
    }

    private setActiveDocumentLink(range: IRange | null): void {
        if (this.activeDocumentLink === range) return;
        this.activeDocumentLink = range;
        this.markDirty();
    }

    private handleMouseMove(event: TUIMouseEvent): void {
        this.setFoldGutterHovered(event.localX >= 0 && event.localX < this.gutterWidth);
        this.pointerCell = { x: event.localX, y: event.localY };
        this.updateHoveredCodeLens();
        this.setActiveDocumentLink(event.ctrlKey ? this.documentLinkAtCell(event.localX, event.localY) : null);

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
            this.typeChar("\n");
            return;
        }

        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
            this.typeChar(event.key);
        }
    }

    /**
     * The `type` command: the same path as the keyboard, one character at a time (upstream `Cursor.type`
     * with the `keyboard` source). Unlike upstream, `onDidType` fires per character, as it does for keys.
     */
    public typeText(text: string): void {
        withCursorChangeSource("keyboard", () => {
            for (const char of text.replace(/\r\n?/g, "\n")) {
                this.typeChar(char);
            }
        });
    }

    /** A line break by a command, not by typing (upstream `EnterOperation`): {@link onDidTypeNewLine} stays silent. */
    public insertLineBreak(): void {
        withCursorChangeSource("keyboard", () => {
            this.pushNewLine();
        });
    }

    private pushNewLine(): void {
        this.pushUndo(this.viewState.insertNewLine(this.languageConfigurationSource?.()?.onEnterRules));
    }

    private typeChar(char: string): void {
        this.onWillTypeEmitter.fire(char);
        if (char === "\n") {
            this.pushNewLine();
            if (!this.viewState.readOnly) this.onDidTypeNewLineEmitter.fire();
            return;
        }
        if (!this.tryTypePaired(char)) this.pushUndo(this.viewState.type(char));
        if (this.viewState.readOnly) return;
        this.onDidTypeEmitter.fire(char);
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
