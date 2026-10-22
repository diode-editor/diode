import type { DisplayLine } from "@tuidom/core/common/displayLine";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";

import { findFirstIdxMonotonousOrArrLen } from "../../base/common/arraysFind.ts";
import type { IRange } from "../common/core/iRange.ts";
import type { ISelection } from "../common/core/iSelection.ts";
import type { ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import type { EditorViewState } from "../common/viewModel/editorViewState.ts";

import type { SemanticTokenIndex, TokenIndex } from "./tokenIndex.ts";
import { applySemanticStyle, packStyleFlags } from "./tokenIndex.ts";

export interface ITextViewportGeometry {
    scrollTop: number;
    scrollLeft: number;
    visibleLines: number;
    viewLineCount: number;
    contentCols: number;
    gutterW: number;
    phantom: ILinePhantom | null;
    /** Document rows of the viewport (view zones left out), from {@link buildViewportRows}. */
    rows: readonly TextViewportRow[];
}

/**
 * Counterpart of upstream injected-text decorations: text absent from the document occupies
 * columns within ONE line and pushes its tail right. One object per frame: painting and all
 * overlay passes compute columns from the same composed line, otherwise highlighting of the
 * tail drifts away from the tail itself.
 */
export interface ILinePhantom {
    readonly line: number;
    /** Phantom columns sit BEFORE this document offset. */
    readonly offset: number;
    readonly text: string;
}

export function composedLineContent(phantom: ILinePhantom | null, line: number, lineContent: string): string {
    if (phantom?.line !== line) return lineContent;
    return lineContent.slice(0, phantom.offset) + phantom.text + lineContent.slice(phantom.offset);
}

/** CHARACTER offset: the character at the insertion point moves right along with the tail. */
export function composedOffset(phantom: ILinePhantom | null, line: number, offset: number): number {
    if (phantom?.line !== line || offset < phantom.offset) return offset;
    return offset + phantom.text.length;
}

/**
 * INSERTION POINT offset: unlike {@link composedOffset}, a cursor exactly at the point stays
 * LEFT of the suggestion (upstream injected-text affinity).
 */
export function composedCaretOffset(phantom: ILinePhantom | null, line: number, offset: number): number {
    if (phantom?.line !== line || offset <= phantom.offset) return offset;
    return offset + phantom.text.length;
}

/** A click on the phantom columns themselves maps to the insertion point. */
export function documentOffset(phantom: ILinePhantom | null, line: number, offset: number): number {
    // Exactly at the insertion point both branches yield `phantom.offset`, so the `<=` → `<` mutant is equivalent.
    // Stryker disable next-line EqualityOperator: see above
    if (phantom?.line !== line || offset <= phantom.offset) return offset;
    return Math.max(phantom.offset, offset - phantom.text.length);
}

/** Like {@link EditorViewState.viewLineStartColumn}, but on an already built composed line. */
function fragmentStartColumn(
    viewState: EditorViewState,
    displayLine: DisplayLine,
    phantom: ILinePhantom | null,
    line: number,
    viewLine: number,
): number {
    const start = viewState.viewLineRange(viewLine).start;
    return displayLine.offsetToColumn(composedOffset(phantom, line, start));
}

/**
 * One document row of the viewport, resolved once per frame: every overlay pass of the frame
 * reads it instead of asking the projection per range (200 K occurrences × screen rows).
 */
export class TextViewportRow {
    private displayLineValue: DisplayLine | null = null;
    private fragmentStartColumnValue = -1;

    public constructor(
        private readonly viewState: EditorViewState,
        private readonly phantom: ILinePhantom | null,
        public readonly screenY: number,
        public readonly viewLine: number,
        public readonly logLine: number,
        public readonly lineContent: string,
        /** `[fragStart, fragEnd)` of the line on this row; the whole line without wrap. */
        public readonly fragStart: number,
        public readonly fragEnd: number,
    ) {}

    /** Only the last fragment carries the virtual newline cell (+1 past the end). */
    public get isLastFragment(): boolean {
        return this.fragEnd === this.lineContent.length;
    }

    /** The composed line, otherwise the highlight drifts from the tail after the phantom. */
    public get displayLine(): DisplayLine {
        this.displayLineValue ??= this.viewState.displayLineFor(
            composedLineContent(this.phantom, this.logLine, this.lineContent),
        );
        return this.displayLineValue;
    }

    public get fragmentStartColumn(): number {
        if (this.fragmentStartColumnValue < 0) {
            this.fragmentStartColumnValue = this.displayLine.offsetToColumn(
                composedOffset(this.phantom, this.logLine, this.fragStart),
            );
        }
        return this.fragmentStartColumnValue;
    }
}

/** Logical lines grow with screenY, so the result is sorted by `logLine`. */
export function buildViewportRows(
    viewState: EditorViewState,
    scrollTop: number,
    visibleLines: number,
    viewLineCount: number,
    phantom: ILinePhantom | null,
): TextViewportRow[] {
    const rows: TextViewportRow[] = [];
    for (let screenY = 0; screenY < visibleLines; screenY++) {
        const viewLine = scrollTop + screenY;
        if (viewLine >= viewLineCount) break;
        const logLine = viewState.visualToLogicalLine(viewLine);
        // A view zone row has no text to highlight.
        if (logLine < 0) continue;
        const frag = viewState.viewLineRange(viewLine);
        rows.push(
            new TextViewportRow(
                viewState,
                phantom,
                screenY,
                viewLine,
                logLine,
                viewState.document.getLineContent(logLine),
                frag.start,
                frag.end,
            ),
        );
    }
    return rows;
}

export function forEachRangeCell(
    range: IRange,
    geo: ITextViewportGeometry,
    visit: (screenX: number, screenY: number) => void,
): void {
    const rows = geo.rows;
    const first = findFirstIdxMonotonousOrArrLen(rows, (row) => row.logLine >= range.start.line);
    for (let i = first; i < rows.length && rows[i].logLine <= range.end.line; i++) {
        const row = rows[i];
        const { logLine, lineContent } = row;
        const dl = row.displayLine;
        const rangeStartChar = logLine === range.start.line ? range.start.character : 0;
        const rangeEndChar = logLine === range.end.line ? range.end.character : lineContent.length + 1;
        const startChar = Math.max(rangeStartChar, row.fragStart);
        const endChar = Math.min(rangeEndChar, row.isLastFragment ? lineContent.length + 1 : row.fragEnd);

        const fragStartCol = row.fragmentStartColumn;
        const startCol = dl.offsetToColumn(composedOffset(geo.phantom, logLine, startChar)) - fragStartCol;
        const endCol =
            (endChar > lineContent.length
                ? dl.displayWidth + 1
                : dl.offsetToColumn(composedOffset(geo.phantom, logLine, endChar))) - fragStartCol;

        const screenXStart = Math.max(0, startCol - geo.scrollLeft);
        const screenXEnd = Math.min(geo.contentCols, endCol - geo.scrollLeft);

        for (let screenX = screenXStart; screenX < screenXEnd; screenX++) {
            visit(geo.gutterW + screenX, row.screenY);
        }
    }
}

/** Only `bg`: the glyph and fg under the highlight are kept. */
export function paintRangeBackground(
    context: RenderContext,
    range: IRange,
    bg: number,
    geo: ITextViewportGeometry,
): void {
    forEachRangeCell(range, geo, (screenX, screenY) => {
        context.setCell(screenX, screenY, { bg });
    });
}

/**
 * Ranges sorted by position and not overlapping (find matches, word occurrences): two binary
 * searches cut them down to the visible lines, so the cost follows the screen, not the file.
 * `skipIndex` leaves one out (the current find match is painted later, on top).
 */
export function paintSortedRangeBackgrounds(
    context: RenderContext,
    ranges: readonly IRange[],
    bg: number,
    geo: ITextViewportGeometry,
    skipIndex = -1,
): void {
    const rows = geo.rows;
    if (rows.length === 0) return;
    const firstLine = rows[0].logLine;
    const lastLine = rows[rows.length - 1].logLine;
    const first = findFirstIdxMonotonousOrArrLen(ranges, (range) => range.end.line >= firstLine);
    for (let i = first; i < ranges.length && ranges[i].start.line <= lastLine; i++) {
        if (i === skipIndex) continue;
        paintRangeBackground(context, ranges[i], bg, geo);
    }
}

export interface IPaintTextLineParams {
    /** Computed by the caller, which owns the tabSize. */
    displayLine: DisplayLine;
    tokenIndex: TokenIndex | null;
    resolveStyle: (metadata: number) => ResolvedTokenStyle;
    /** Overrides TextMate only in attributes the theme sets. */
    semanticIndex: SemanticTokenIndex | null;
    screenY: number;
    gutterW: number;
    contentCols: number;
    scrollLeft: number;
    /** Shifts the line's column window under wrap, like scrollLeft but per row. */
    startColumn: number;
    /** Beyond it lies the NEXT fragment's text; spaces are painted up to the edge instead. */
    endColumnExclusive: number;
    fg: number;
    bg: number;
    /** False for diff: the added/deleted line background must win over the token background. */
    allowTokenBg: boolean;
    /** Phantom slots skip token lookup; offsets right of it are mapped back to document offsets. */
    phantom: IPaintTextLinePhantom | null;
}

export interface IPaintTextLinePhantom {
    readonly startOffset: number;
    readonly length: number;
    readonly fg: number;
    readonly style: number;
}

/** Walks DISPLAY columns to handle wide characters, tabs and horizontal scroll. */
export function paintTextLine(context: RenderContext, params: IPaintTextLineParams): void {
    const {
        displayLine,
        tokenIndex,
        semanticIndex,
        resolveStyle,
        screenY,
        gutterW,
        contentCols,
        scrollLeft,
        startColumn,
    } = params;
    const phantomEnd = params.phantom === null ? 0 : params.phantom.startOffset + params.phantom.length;

    let screenX = 0;
    while (screenX < contentCols) {
        const displayCol = scrollLeft + startColumn + screenX;
        if (displayCol >= params.endColumnExclusive) {
            context.setCell(gutterW + screenX, screenY, {
                char: " ",
                fg: params.fg,
                bg: params.bg,
                style: StyleFlags.None,
                width: 1,
            });
            screenX++;
            continue;
        }
        const char = displayLine.charAtColumn(displayCol);
        if (char === "") {
            screenX++;
            continue;
        }
        const slot = displayLine.graphemeAtColumn(displayCol);
        /* v8 ignore start -- defensive: columns past the line end (>= endColumnExclusive <= displayWidth) went to the fill above; within the painted range a slot always exists */
        // Stryker disable next-line ConditionalExpression,EqualityOperator,BlockStatement: unreachable defensive guard, see v8 ignore
        if (slot === undefined) {
            screenX++;
            continue;
        }
        /* v8 ignore stop */
        const width = slot.displayWidth;

        let fg = params.fg;
        let bg = params.bg;
        let style: number = StyleFlags.None;
        const phantom = params.phantom;
        if (phantom !== null && slot.offset >= phantom.startOffset && slot.offset < phantomEnd) {
            fg = phantom.fg;
            style = phantom.style;
        } else {
            // Right of the phantom the composed offset runs ahead of the document offset.
            const offset = phantom !== null && slot.offset >= phantomEnd ? slot.offset - phantom.length : slot.offset;
            const metadata = tokenIndex?.metadataAt(offset);
            // Stryker disable next-line ConditionalExpression: with no token the resolver returns an empty style for `undefined`, giving the same fg/bg/style
            if (metadata !== undefined) {
                const resolved = resolveStyle(metadata);
                if (resolved.fg !== undefined) fg = resolved.fg;
                if (params.allowTokenBg && resolved.bg !== undefined) bg = resolved.bg;
                style = packStyleFlags(resolved);
            }
            const semantic = semanticIndex?.styleAt(offset);
            if (semantic) ({ fg, flags: style } = applySemanticStyle(semantic, fg, style));
        }

        if (slot.grapheme === "\t") {
            // Grid/TerminalRenderer only know width 1 and 2, so a tab is expanded into spaces.
            for (let i = 0; i < width && screenX + i < contentCols; i++) {
                context.setCell(gutterW + screenX + i, screenY, { char: " ", fg, bg, style, width: 1 });
            }
            screenX += width;
        } else if (width === 2 && screenX + 1 >= contentCols) {
            context.setCell(gutterW + screenX, screenY, { char: " ", fg, bg, style, width: 1 });
            screenX++;
        } else {
            context.setCell(gutterW + screenX, screenY, { char, fg, bg, style, width });
            screenX += width;
        }
    }
}

export interface IPaintPhantomTextParams {
    displayLine: DisplayLine;
    screenY: number;
    gutterW: number;
    contentCols: number;
    fg: number;
    bg: number;
    /** Packed {@link StyleFlags}. */
    style: number;
}

/**
 * A ghost text view zone row (`lines[1..]`); the suggestion's first line never gets here,
 * it is spliced into its own line as phantom columns ({@link ILinePhantom}).
 */
export function paintPhantomText(context: RenderContext, params: IPaintPhantomTextParams): void {
    const { displayLine, screenY, gutterW, contentCols, fg, bg, style } = params;

    let col = 0;
    // Cutting off past the line end is about speed: RenderContext clips to the element
    // rectangle, so boundary mutants cannot be killed.
    // Stryker disable next-line EqualityOperator: see above
    while (col < displayLine.displayWidth) {
        // Stryker disable next-line ConditionalExpression,EqualityOperator: viewport clipping is about speed, setCell outside the rectangle returns silently anyway
        if (col >= contentCols) break;
        const char = displayLine.charAtColumn(col);
        /* v8 ignore start -- defensive: col steps by slot widths from 0 and never lands on a wide character's continuation column (unlike paintTextLine, where displayCol starts at an arbitrary scrollLeft) */
        // Stryker disable ConditionalExpression,EqualityOperator,BlockStatement,StringLiteral,UpdateOperator: unreachable defensive guard, see v8 ignore
        if (char === "") {
            col++;
            continue;
        }
        // Stryker restore ConditionalExpression,EqualityOperator,BlockStatement,StringLiteral,UpdateOperator
        /* v8 ignore stop */
        const slot = displayLine.graphemeAtColumn(col);
        /* v8 ignore start -- defensive: within displayWidth a slot always exists (see paintTextLine) */
        // Stryker disable ConditionalExpression,EqualityOperator,BlockStatement,UpdateOperator: unreachable defensive guard, see v8 ignore
        if (slot === undefined) {
            col++;
            continue;
        }
        // Stryker restore ConditionalExpression,EqualityOperator,BlockStatement,UpdateOperator
        /* v8 ignore stop */
        const width = slot.displayWidth;

        if (slot.grapheme === "\t") {
            // Tab spaces are indistinguishable from the tail's background spaces: the fill exists for
            // fg/style that are invisible on a space; only the col step is observable, so fill mutants cannot be killed.
            // Stryker disable ConditionalExpression,LogicalOperator,EqualityOperator,ArithmeticOperator,BlockStatement,ObjectLiteral,StringLiteral,CallExpression: see above
            for (let i = 0; i < width && col + i < contentCols; i++) {
                context.setCell(gutterW + col + i, screenY, { char: " ", fg, bg, style, width: 1 });
            }
            // Stryker restore ConditionalExpression,LogicalOperator,EqualityOperator,ArithmeticOperator,BlockStatement,ObjectLiteral,StringLiteral,CallExpression
            col += width;
        } else if (width === 2 && col + 1 >= contentCols) {
            // A space at the edge is indistinguishable from background (see the tab above); only
            // the fact that the wide character is NOT painted is observable.
            // Stryker disable next-line ArithmeticOperator,ObjectLiteral,StringLiteral,CallExpression: see above
            context.setCell(gutterW + col, screenY, { char: " ", fg, bg, style, width: 1 });
            col++;
        } else {
            context.setCell(gutterW + col, screenY, { char, fg, bg, style, width });
            col += width;
        }
    }
}

/** `null` when the cursor is outside the visible area. */
export function caretLocalCell(
    viewState: EditorViewState,
    gutterW: number,
    size: Size,
    phantom: ILinePhantom | null = null,
): Point | null {
    const primary = viewState.selections[0];
    const cursorVisualLine = viewState.viewLineForPosition(primary.active.line, primary.active.character);
    const cursorLineContent = viewState.getViewLine(cursorVisualLine);
    const cursorDl = viewState.displayLineFor(composedLineContent(phantom, primary.active.line, cursorLineContent));
    const localX =
        cursorDl.offsetToColumn(composedCaretOffset(phantom, primary.active.line, primary.active.character)) -
        fragmentStartColumn(viewState, cursorDl, phantom, primary.active.line, cursorVisualLine) -
        viewState.scrollLeft +
        gutterW;
    const localY = cursorVisualLine - viewState.scrollTop;

    if (localX < gutterW || localX >= size.width || localY < 0 || localY >= size.height) {
        return null;
    }
    return new Point(localX, localY);
}

export interface ICaretColors {
    readonly fg: number;
    readonly bg: number;
}

/**
 * The terminal has a single hardware cursor, so multi-cursor is painted with cells. The patch has
 * no `char`/`width`: the glyph is kept, and `Grid.updateCell` paints a wide character's
 * continuation cell. `style` is reset explicitly so the cursor does not carry the glyph's bold/undercurl.
 */
export function paintCarets(
    context: RenderContext,
    viewState: EditorViewState,
    selections: readonly ISelection[],
    colors: ICaretColors,
    geo: ITextViewportGeometry,
): void {
    // The viewport cutoffs below are about speed: setCell clips to the element rectangle and
    // returns silently on a miss, so their mutants cannot be killed.
    // Stryker disable EqualityOperator,ConditionalExpression,LogicalOperator: see above
    const displayLineByDocLine = new Map<number, DisplayLine>();
    for (const selection of selections) {
        const row = viewState.viewLineForPosition(selection.active.line, selection.active.character);
        if (row < 0) continue;
        const screenY = row - geo.scrollTop;
        if (screenY < 0 || screenY >= geo.visibleLines) continue;

        // The per-line DisplayLine cache is pure memoization.
        // Stryker disable next-line CallExpression: see above
        let dl = displayLineByDocLine.get(selection.active.line);
        if (dl === undefined) {
            dl = viewState.displayLineFor(
                composedLineContent(
                    geo.phantom,
                    selection.active.line,
                    viewState.document.getLineContent(selection.active.line),
                ),
            );
            // Stryker disable next-line CallExpression: cache fill, does not change the result
            displayLineByDocLine.set(selection.active.line, dl);
        }

        const localX =
            dl.offsetToColumn(composedCaretOffset(geo.phantom, selection.active.line, selection.active.character)) -
            fragmentStartColumn(viewState, dl, geo.phantom, selection.active.line, row) -
            geo.scrollLeft;
        if (localX < 0 || localX >= geo.contentCols) continue;
        // Stryker restore EqualityOperator,ConditionalExpression,LogicalOperator

        context.setCell(geo.gutterW + localX, screenY, {
            fg: colors.fg,
            bg: colors.bg,
            style: StyleFlags.None,
        });
    }
}

/** A gutter click maps to column 0 of the row, like a line-number click in VS Code. */
export function docPositionAt(
    viewState: EditorViewState,
    gutterW: number,
    localX: number,
    localY: number,
    phantom: ILinePhantom | null = null,
): { line: number; character: number } {
    const viewLineCount = viewState.getViewLineCount();
    /* v8 ignore start -- unreachable: a TextDocument always has at least one line and a fold header is never hidden, so getViewLineCount() is never 0 */
    if (viewLineCount === 0) return { line: 0, character: 0 };
    /* v8 ignore stop */

    const viewLine = Math.min(viewState.scrollTop + localY, viewLineCount - 1);
    // A view zone row maps to the nearest document line, as in VS Code.
    const logLine = viewState.docLineForViewLine(viewLine);
    const lineContent = viewState.document.getLineContent(logLine);
    const dl = viewState.displayLineFor(composedLineContent(phantom, logLine, lineContent));
    // On a wrapped continuation row, column 0 is the fragment start.
    const fragStartCol = fragmentStartColumn(viewState, dl, phantom, logLine, viewLine);
    const displayCol = fragStartCol + (localX < gutterW ? 0 : localX - gutterW + viewState.scrollLeft);
    let charOffset = documentOffset(phantom, logLine, dl.columnToOffset(displayCol));
    // A click right of a non-last fragment must not drag the cursor to the next row (the
    // boundary offset belongs to it). View zones and empty lines have frag.end = 0.
    const frag = viewState.viewLineRange(viewLine);
    if (frag.end > 0 && frag.end < lineContent.length && charOffset >= frag.end) {
        charOffset = documentOffset(
            phantom,
            logLine,
            dl.columnToOffset(dl.offsetToColumn(composedOffset(phantom, logLine, frag.end)) - 1),
        );
    }
    return { line: logLine, character: charOffset };
}
