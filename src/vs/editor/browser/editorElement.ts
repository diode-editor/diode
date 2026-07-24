import { packRgb } from "../../../../tuidom/common/colorUtils.ts";
import { Point } from "../../../../tuidom/common/geometryPromitives.ts";
import { StyleFlags } from "../../../../tuidom/common/styleFlags.ts";
import type { TUIEventBase } from "../../../../tuidom/dom/events/tuiEventBase.ts";
import type { TUIKeyboardEvent } from "../../../../tuidom/dom/events/tuiKeyboardEvent.ts";
import type { TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import type { TUIPasteEvent } from "../../../../tuidom/dom/events/tuiPasteEvent.ts";
import { RenderContext, TUIElement } from "../../../../tuidom/dom/tuiElement.ts";
import type { BodyElement } from "../../../../tuidom/ui/body/bodyElement.ts";
import type { OverlaySessionHandle } from "../../../../tuidom/ui/contextview/overlayLayer.ts";
import type { MenuEntry } from "../../../../tuidom/ui/menu/popupMenuElement.ts";
import { PopupMenuElement } from "../../../../tuidom/ui/menu/popupMenuElement.ts";
import type { IMenuStyles } from "../../../../tuidom/ui/menu/popupMenuItemElement.tsx";
import { unthemedMenuStyles } from "../../../../tuidom/ui/menu/popupMenuItemElement.tsx";
import type { IScrollable } from "../../../../tuidom/ui/scrollbar/iScrollable.ts";
import type { IMarkerDecoration } from "../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import type { IRange } from "../common/core/iRange.ts";
import {
    createCursorSelection,
    createSelection,
    isSelectionCollapsed,
    selectionToRange,
} from "../common/core/iSelection.ts";
import { findWordRangeAt } from "../common/core/wordClassification.ts";
import type { ILineTokens, IToken } from "../common/languages/iLineTokens.ts";
import type { ITokenStyleResolver, ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../common/languages/iTokenStyleResolver.ts";
import type { IGutterChangeDecoration } from "../common/model/iGutterChangeDecoration.ts";
import type { IUndoElement } from "../common/model/iUndoElement.ts";
import { UndoManager } from "../common/model/undoManager.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { LineWidthCache } from "../common/viewModel/lineWidthCache.ts";
import { computeWordOccurrences } from "../contrib/find/computeWordOccurrences.ts";
import { computeIndentLevel } from "../contrib/folding/foldingRangeProvider.ts";
import type { IFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

const SELECTION_BG = packRgb(38, 79, 120);
// Find-in-file highlights: all matches get a dim background; the current match a brighter one.
const FIND_MATCH_BG = packRgb(98, 91, 23);
const FIND_MATCH_CURRENT_BG = packRgb(168, 109, 0);
const NO_RANGES: readonly IRange[] = [];
const NO_MARKER_DECORATIONS: readonly IMarkerDecoration[] = [];
const NO_GUTTER_CHANGE_DECORATIONS: readonly IGutterChangeDecoration[] = [];
// Change-bar glyph — VS Code's dirty-diff gutter paints a thin border; in a cell
// grid we use the heavy box-drawing vertical so the bar sits centered in its
// cell, one column left of the fold chevron. Modified lines use the dashed
// variant (VS Code draws them hatched); added/deleted stay solid.
const GUTTER_CHANGE_BAR = "┃";
const GUTTER_CHANGE_BAR_DASHED = "┋";
const GUTTER_LEFT_PADDING = 2;

// Codicon chevrons — VS Code's own folding-control glyphs. Thinner than the
// Nerd Font fa-angle used for the file-tree arrows, so they don't crowd the text.
const FOLD_ICON_EXPANDED = "\ueab4"; //  nf-cod-chevron_down
const FOLD_ICON_COLLAPSED = "\ueab6"; //  nf-cod-chevron_right
// Blank columns padding the fold chevron inside the gutter: one gap after the
// line number and one before the text, so the chevron doesn't crowd either. The
// chevron itself sits between them → a 3-column fold margin.
const FOLD_GAP_LEFT = 1;
const FOLD_GAP_RIGHT = 1;
// Marker drawn after a collapsed region's header line, standing in for the hidden body.
const FOLD_COLLAPSED_MARKER = "⋯"; // ⋯ horizontal ellipsis
// Marker drawn at the cut point of an extremely long line whose rendering was
// stopped at STOP_RENDERING_LINE_AFTER (VS Code shows the same overflow ellipsis).
const LONG_LINE_TRUNCATION_MARKER = "…"; // U+2026 horizontal ellipsis

// Indentation guide: a vertical line drawn over a region's leading whitespace,
// spanning the region's body.
const INDENT_GUIDE = "│"; // U+2502 box drawings light vertical

/**
 * Специализированные цвета редактора (гуттер, подсветки, squiggles, контекстное
 * меню). Основные fg/bg редактора сюда не входят — они задаются через
 * `editor.style = { fg, bg }` (система наследования TUIStyle).
 */
export interface IEditorStyles {
    /** `undefined` — гуттер наследует фон редактора (`resolvedStyle.bg`). */
    readonly gutterBackground: number | undefined;
    readonly lineNumberForeground: number;
    readonly lineNumberActiveForeground: number;
    /** Background used to highlight occurrences of the word under the cursor. */
    readonly occurrenceHighlightBackground: number;
    readonly foldingControlForeground: number;
    /** Colour of the indentation guides (VS Code `editorIndentGuide.background1`). */
    readonly indentGuideForeground: number;
    /** Colour of the active indentation guide (VS Code `editorIndentGuide.activeBackground1`). */
    readonly indentGuideActiveForeground: number;
    /** Squiggle foreground per severity (`editorError/Warning/Info/Hint.foreground`). */
    readonly errorForeground: number;
    readonly warningForeground: number;
    readonly infoForeground: number;
    readonly hintForeground: number;
    /** Стили контекстного меню (цвета `menu.*` уже резолвнуты). */
    readonly menu: IMenuStyles;
}

// Defaults preserve the historical theme-less look (VS Code dark values; the
// occurrence highlight is an opaque approximation of #575757b8 composited over
// the editor bg). Workbench components override them via setStyles from the active theme.
export const unthemedEditorStyles: IEditorStyles = {
    gutterBackground: undefined,
    lineNumberForeground: packRgb(133, 133, 133),
    lineNumberActiveForeground: packRgb(198, 198, 198),
    occurrenceHighlightBackground: packRgb(71, 71, 71),
    foldingControlForeground: packRgb(197, 197, 197),
    indentGuideForeground: packRgb(0x40, 0x40, 0x40), // #404040
    indentGuideActiveForeground: packRgb(0x70, 0x70, 0x70), // #707070
    errorForeground: packRgb(0xf1, 0x4c, 0x4c),
    warningForeground: packRgb(0xcc, 0xa7, 0x00),
    infoForeground: packRgb(0x37, 0x94, 0xff),
    hintForeground: packRgb(0xee, 0xee, 0xee),
    menu: unthemedMenuStyles,
};

/** Viewport geometry shared by the range-background highlight passes. */
interface RangeHighlightGeometry {
    scrollTop: number;
    scrollLeft: number;
    visibleLines: number;
    viewLineCount: number;
    contentCols: number;
    gutterW: number;
}

/**
 * TUI element that renders a text editor backed by EditorViewState.
 * Handles keyboard input (printable chars, Enter, Backspace, Delete)
 * and draws the document content with a hardware cursor.
 */
export class EditorElement extends TUIElement implements IScrollable {
    public readonly viewState: EditorViewState;
    public readonly undoManager: UndoManager;
    /**
     * Resolves TextMate scopes to {@link ResolvedTokenStyle}. Defaults to a
     * no-op resolver; concrete implementations live in the Theme layer (or
     * are supplied by an LSP semantic-tokens provider).
     */
    public tokenStyleResolver: ITokenStyleResolver = NULL_TOKEN_STYLE_RESOLVER;

    public get tabSize(): number {
        return this.viewState.tabSize;
    }

    public set tabSize(value: number) {
        this.viewState.tabSize = value;
    }

    /** Whether to highlight occurrences of the word under the cursor (VS Code `editor.occurrencesHighlight`). */
    public occurrenceHighlightEnabled = true;

    /** Diagnostic squiggle decorations for the open document (pushed by the controller). */
    public markerDecorations: readonly IMarkerDecoration[] = NO_MARKER_DECORATIONS;
    /** Gutter change-bar decorations (SCM/git dirty-diff) for the open document (pushed by the controller). */
    public gutterChangeDecorations: readonly IGutterChangeDecoration[] = NO_GUTTER_CHANGE_DECORATIONS;

    public contextMenuEntries: MenuEntry[] = [];
    /**
     * Ленивый источник пунктов контекст-меню — резолвится в момент ОТКРЫТИЯ (чтобы
     * `when`-видимость пунктов учитывала актуальный контекст). Если задан,
     * перекрывает статический {@link contextMenuEntries}.
     */
    public contextMenuProvider?: () => MenuEntry[];
    /** Цвета редактора (см. {@link IEditorStyles}); задаются контроллером через {@link setStyles}. */
    private styles: IEditorStyles = unthemedEditorStyles;

    private lineWidthCache: LineWidthCache | null = null;
    private occurrenceCache: { versionId: number; line: number; character: number; ranges: IRange[] } | null = null;
    private activeContextMenuSession: OverlaySessionHandle | null = null;

    public get contentHeight(): number {
        return this.viewState.getViewLineCount();
    }

    public get contentWidth(): number {
        // The width cache tracks edits incrementally off onDidChangeContent, so
        // this is O(1) between edits and re-measures only changed lines after one
        // — unlike the old per-versionId whole-document rescan that froze the
        // editor on long lines (worst of all in the Output panel). Bound once to
        // the document, which is fixed per EditorElement (a disk reload builds a
        // fresh element).
        if (this.lineWidthCache === null) {
            this.lineWidthCache = new LineWidthCache(this.viewState.document, this.tabSize);
        }
        this.lineWidthCache.setTabSize(this.tabSize);
        return this.lineWidthCache.getMaxWidth();
    }

    public get scrollTop(): number {
        return this.viewState.scrollTop;
    }

    public get scrollLeft(): number {
        return this.viewState.scrollLeft;
    }

    /**
     * Observable editor state for the inspector — cursor, selections, readonly,
     * scroll, folded regions, language. Lets e2e assert on data (e.g. «selection
     * survived a live channel», «readonly gated the edit») instead of guessing
     * from painted cells. Plain JSON, read from `viewState`.
     */
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
            tabSize: vs.tabSize,
            scrollTop: vs.scrollTop,
            scrollLeft: vs.scrollLeft,
            selections,
            hasSelection: selections.some((s) => !s.collapsed),
            foldedRegions: vs.foldedRegions.map((r) => ({ startLine: r.startLine, endLine: r.endLine })),
        };
    }

    public get gutterWidth(): number {
        const viewLineCount = this.viewState.getViewLineCount();
        const digitCount = Math.max(1, Math.floor(Math.log10(viewLineCount)) + 1);
        return GUTTER_LEFT_PADDING + digitCount + FOLD_GAP_LEFT + 1 + FOLD_GAP_RIGHT;
    }

    /** Gutter column holding the fold chevron; {@link FOLD_GAP_RIGHT} blanks follow it. */
    public get foldControlColumn(): number {
        return this.gutterWidth - 1 - FOLD_GAP_RIGHT;
    }

    /**
     * Абсолютные (экранные) координаты ячейки каретки первичного курсора, или
     * `null`, если каретка вне видимой области. Используется для якорения
     * completion-попапа (та же математика, что в {@link render}).
     */
    public getCaretScreenCell(): Point | null {
        const gutterW = this.gutterWidth;
        const scrollTop = this.viewState.scrollTop;
        const scrollLeft = this.viewState.scrollLeft;
        const visibleLines = this.layoutSize.height;

        const primary = this.viewState.selections[0];
        const cursorVisualLine = this.viewState.logicalToVisualLine(primary.active.line);
        const cursorLineContent = this.viewState.getViewLine(cursorVisualLine);
        const cursorDl = this.viewState.displayLineFor(cursorLineContent);
        const localX = cursorDl.offsetToColumn(primary.active.character) - scrollLeft + gutterW;
        const localY = cursorVisualLine - scrollTop;

        if (localX < gutterW || localX >= this.layoutSize.width || localY < 0 || localY >= visibleLines) {
            return null;
        }
        return new Point(this.globalPosition.x + localX, this.globalPosition.y + localY);
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
        this.tabIndex = 0;
        this.viewState = viewState;
        this.undoManager = new UndoManager(viewState.document, viewState);

        this.addEventListener("keypress", (event) => {
            this.handleKeyPress(event);
        });
        this.addEventListener("paste", (event) => {
            this.handlePaste(event);
        });
        this.addEventListener("mousedown", (event) => {
            this.handleMouseDown(event);
        });
        this.addEventListener("dblclick", (event) => {
            this.handleDoubleClick(event);
        });
        this.addEventListener("mousemove", (event) => {
            this.handleMouseMove(event);
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

    /**
     * Режим «только чтение» (VS Code `EditorOption.readOnly`). Истина живёт на
     * `EditorViewState` — через него проходят все правки; здесь только чтение,
     * чтобы `WorkbenchContextKeys` мог спросить сфокусированный виджет напрямую.
     * Выставляют флаг через `TextEditorPane.readOnly` — он ещё и файрит событие.
     */
    public get readOnly(): boolean {
        return this.viewState.readOnly;
    }

    /** Единственный канал обновления цветов редактора (маппинг темы делает Workbench-мост). */
    public setStyles(styles: IEditorStyles): void {
        this.styles = styles;
        this.markDirty();
    }

    public render(context: RenderContext): void {
        const gutterW = this.gutterWidth;
        const contentCols = this.layoutSize.width - gutterW;
        this.viewState.viewportWidth = contentCols;
        this.viewState.viewportHeight = this.layoutSize.height;
        const scrollTop = this.viewState.scrollTop;
        const scrollLeft = this.viewState.scrollLeft;
        const visibleLines = this.layoutSize.height;
        const viewLineCount = this.viewState.getViewLineCount();

        const editorFg = this.resolvedStyle.fg;
        const editorBg = this.resolvedStyle.bg;
        const gutBg = this.styles.gutterBackground ?? editorBg;
        const lnFg = this.styles.lineNumberForeground;
        const lnActiveFg = this.styles.lineNumberActiveForeground;

        const primaryLine = this.viewState.selections[0].active.line;
        const digitCount = gutterW - GUTTER_LEFT_PADDING - FOLD_GAP_LEFT - 1 - FOLD_GAP_RIGHT;
        const foldFg = this.styles.foldingControlForeground;

        // Fold-region headers by their (logical) start line, so the gutter can draw
        // a chevron and the header line a collapsed marker without scanning per cell.
        const foldHeaderByLine = new Map<number, boolean>();
        for (const region of this.viewState.foldedRegions) {
            foldHeaderByLine.set(region.startLine, region.isCollapsed);
        }

        // Change-bar colour + style by (logical) line, flattened once per frame
        // so each visible row is a single lookup. A deleted hunk is one boundary
        // line (its range covers just that line).
        const gutterChangeByLine = new Map<number, { color: number; dashed: boolean }>();
        for (const decoration of this.gutterChangeDecorations) {
            for (let line = decoration.range.start.line; line <= decoration.range.end.line; line++) {
                gutterChangeByLine.set(line, { color: decoration.color, dashed: decoration.dashed === true });
            }
        }

        // Bring the token cache up to the bottom of the viewport before reading.
        const tokenStore = this.viewState.tokenStore;
        if (tokenStore) {
            const lastVisibleLogical = this.viewState.visualToLogicalLine(
                Math.min(scrollTop + visibleLines - 1, viewLineCount - 1),
            );
            if (lastVisibleLogical >= 0) tokenStore.tokenizeUpTo(lastVisibleLogical);
        }

        // Frame-local cache of resolved styles to avoid re-walking the rule list
        // for repeated scopes within a single render pass.
        const styleCache = new Map<readonly string[], ResolvedTokenStyle>();
        const resolveStyle = (scopes: readonly string[]): ResolvedTokenStyle => {
            const cached = styleCache.get(scopes);
            if (cached) return cached;
            const result = this.tokenStyleResolver.resolve(scopes);
            styleCache.set(scopes, result);
            return result;
        };

        for (let screenY = 0; screenY < visibleLines; screenY++) {
            const viewLine = scrollTop + screenY;

            // --- Gutter ---
            if (viewLine < viewLineCount) {
                const logLine = this.viewState.visualToLogicalLine(viewLine);
                const lineNumStr = String(logLine + 1).padStart(digitCount, " ");
                const isActive = logLine === primaryLine;
                const numFg = isActive ? lnActiveFg : lnFg;

                // Left padding
                for (let x = 0; x < GUTTER_LEFT_PADDING; x++) {
                    context.setCell(x, screenY, { char: " ", fg: numFg, bg: gutBg });
                }
                // Line number digits
                for (let d = 0; d < digitCount; d++) {
                    context.setCell(GUTTER_LEFT_PADDING + d, screenY, { char: lineNumStr[d], fg: numFg, bg: gutBg });
                }
                // Fold control column plus a blank gap before the text (the gap
                // also separates the line number from the content). On a foldable
                // header line the control shows a chevron (down = expanded, right
                // = collapsed).
                const foldCol = this.foldControlColumn;
                for (let x = GUTTER_LEFT_PADDING + digitCount; x < gutterW; x++) {
                    context.setCell(x, screenY, { char: " ", fg: numFg, bg: gutBg });
                }
                // Change bar in the left fold column (immediately left of the
                // chevron), painted after the fold-area blanks so it survives.
                // Modified lines get a dashed bar (VS Code dirty-diff style).
                const change = gutterChangeByLine.get(logLine);
                if (change !== undefined) {
                    const char = change.dashed ? GUTTER_CHANGE_BAR_DASHED : GUTTER_CHANGE_BAR;
                    context.setCell(foldCol - 1, screenY, { char, fg: change.color, bg: gutBg });
                }
                const foldState = foldHeaderByLine.get(logLine);
                // Collapsed regions always show their chevron; expanded ones only
                // while the gutter is hovered (VS Code `showFoldingControls`).
                const showChevron = foldState === true || (foldState === false && this.foldGutterHovered);
                if (showChevron) {
                    const icon = foldState ? FOLD_ICON_COLLAPSED : FOLD_ICON_EXPANDED;
                    context.setCell(foldCol, screenY, { char: icon, fg: foldFg, bg: gutBg });
                }
            } else {
                // Past end of document — empty gutter
                for (let x = 0; x < gutterW; x++) {
                    context.setCell(x, screenY, { char: " ", bg: gutBg });
                }
            }

            // --- Content area ---
            if (viewLine >= viewLineCount) {
                // Past end of document — empty content area (VS Code draws no vim-style tildes)
                for (let x = 0; x < contentCols; x++) {
                    context.setCell(gutterW + x, screenY, { char: " ", fg: editorFg, bg: editorBg });
                }
                continue;
            }

            const lineContent = this.viewState.getViewLine(viewLine);
            const dl = this.viewState.displayLineFor(lineContent);
            const lineTokens = this.viewState.getViewLineTokens(viewLine);
            const tokenIndex = lineTokens ? new TokenIndex(lineTokens, lineContent.length) : null;

            let screenX = 0;
            while (screenX < contentCols) {
                const displayCol = scrollLeft + screenX;
                const char = dl.charAtColumn(displayCol);
                if (char === "") {
                    // Continuation column of a wide char — skip, already handled by Grid
                    screenX++;
                    continue;
                }
                const slot = dl.graphemeAtColumn(displayCol);
                const width = slot ? slot.displayWidth : 1;

                // Resolve style for this offset.
                let fg = editorFg;
                let bg = editorBg;
                let style: number = StyleFlags.None;
                if (tokenIndex && slot) {
                    const offset = slot.offset;
                    const token = tokenIndex.tokenAt(offset);
                    if (token) {
                        const resolved = resolveStyle(token.scopes);
                        if (resolved.fg !== undefined) fg = resolved.fg;
                        if (resolved.bg !== undefined) bg = resolved.bg;
                        style = packStyleFlags(resolved);
                    }
                }

                if (slot?.grapheme === "\t") {
                    // Tab: render each column as an individual space so Grid/TerminalRenderer
                    // tracks the cursor correctly (they only support width=1 and width=2).
                    for (let i = 0; i < width && screenX + i < contentCols; i++) {
                        context.setCell(gutterW + screenX + i, screenY, { char: " ", fg, bg, style });
                    }
                    screenX += width;
                } else if (width === 2 && screenX + 1 >= contentCols) {
                    // Wide char doesn't fit at the right edge — render space instead
                    context.setCell(gutterW + screenX, screenY, { char: " ", fg, bg, style, width: 1 });
                    screenX++;
                } else {
                    context.setCell(gutterW + screenX, screenY, { char, fg, bg, style, width });
                    screenX += width;
                }
            }

            // Extremely long line: rendering stopped at STOP_RENDERING_LINE_AFTER.
            // Draw an overflow ellipsis at the cut point when it is on screen, so
            // the truncation is visible rather than silent (à la VS Code).
            if (dl.isTruncated) {
                const markerCol = dl.displayWidth - scrollLeft;
                if (markerCol >= 0 && markerCol < contentCols) {
                    context.setCell(gutterW + markerCol, screenY, {
                        char: LONG_LINE_TRUNCATION_MARKER,
                        fg: editorFg,
                        bg: editorBg,
                    });
                }
            }

            // Collapsed region: draw a marker after the header line's content,
            // standing in for the hidden body (VS Code's inline "⋯").
            if (foldHeaderByLine.get(this.viewState.visualToLogicalLine(viewLine)) === true) {
                const markerCol = dl.displayWidth + 1 - scrollLeft;
                if (markerCol >= 0 && markerCol < contentCols) {
                    context.setCell(gutterW + markerCol, screenY, {
                        char: FOLD_COLLAPSED_MARKER,
                        fg: foldFg,
                        bg: editorBg,
                    });
                }
            }
        }

        // Shared geometry for the range-background highlight passes below.
        const geometry: RangeHighlightGeometry = {
            scrollTop,
            scrollLeft,
            visibleLines,
            viewLineCount,
            contentCols,
            gutterW,
        };

        // Indentation guides for folding regions, drawn over the leading
        // whitespace before the range-highlight passes below — those set only
        // `bg`, so a selection/search background composes over the guide glyph.
        this.paintIndentGuides(context, geometry, editorBg, primaryLine);

        // Highlight all occurrences of the word under the cursor (weakest layer,
        // painted first so selections and search matches win where they overlap).
        const occurrenceBg = this.styles.occurrenceHighlightBackground;
        for (const range of this.getOccurrenceHighlights()) {
            this.paintRangeBackground(context, range, occurrenceBg, geometry);
        }

        // Highlight all search matches except the current one (drawn under selections).
        const searchMatches = this.viewState.searchMatches;
        const currentMatchIndex = this.viewState.currentSearchMatchIndex;
        for (let i = 0; i < searchMatches.length; i++) {
            if (i === currentMatchIndex) continue;
            this.paintRangeBackground(context, searchMatches[i], FIND_MATCH_BG, geometry);
        }

        // Highlight selections
        for (const sel of this.viewState.selections) {
            if (isSelectionCollapsed(sel)) continue;
            this.paintRangeBackground(context, selectionToRange(sel), SELECTION_BG, geometry);
        }

        // Highlight the current search match on top (wins over other matches and selection).
        if (currentMatchIndex >= 0 && currentMatchIndex < searchMatches.length) {
            this.paintRangeBackground(context, searchMatches[currentMatchIndex], FIND_MATCH_CURRENT_BG, geometry);
        }

        // Diagnostic squiggles on top of the content — painted last (after the
        // background passes) so the severity colour and undercurl win.
        for (const decoration of this.markerDecorations) {
            this.paintMarkerDecoration(context, decoration, geometry);
        }

        // Position hardware cursor at the primary selection's active position
        const primary = this.viewState.selections[0];
        const cursorVisualLine = this.viewState.logicalToVisualLine(primary.active.line);
        const cursorLineContent = this.viewState.getViewLine(cursorVisualLine);
        const cursorDl = this.viewState.displayLineFor(cursorLineContent);
        const cursorScreenX = cursorDl.offsetToColumn(primary.active.character) - scrollLeft + gutterW;
        const cursorScreenY = cursorVisualLine - scrollTop;

        if (
            this.isFocused &&
            cursorScreenX >= gutterW &&
            cursorScreenX < this.layoutSize.width &&
            cursorScreenY >= 0 &&
            cursorScreenY < visibleLines
        ) {
            context.setCursorPosition(cursorScreenX, cursorScreenY);
        }
    }

    /**
     * Draws a vertical indentation guide for every folding region: a `│` over the
     * region's leading whitespace, at the header's indent column, spanning the
     * region's body lines. The innermost region enclosing the cursor line is the
     * "active" guide and uses the brighter colour (VS Code's
     * `highlightActiveIndentation`). The guide only ever lands on a body line's
     * leading whitespace — indentation folds satisfy that by construction, but
     * extension-provided regions do not (a `#region` marker sits at the same
     * indent as the code it wraps), so every cell is checked against the body
     * line's own indent. Collapsed regions contribute nothing (their body is
     * hidden).
     */
    private paintIndentGuides(
        context: RenderContext,
        geo: RangeHighlightGeometry,
        editorBg: number,
        primaryLine: number,
    ): void {
        const regions = this.viewState.foldedRegions;
        if (regions.length === 0) return;

        const doc = this.viewState.document;
        const tabSize = this.tabSize;

        // Visible logical line → screenY (folding may hide lines, so this is sparse).
        // Logical lines increase monotonically with screenY, so the first is the
        // minimum and the last assigned is the maximum.
        const screenYByLogical = new Map<number, number>();
        let minLog = -1;
        let maxLog = -1;
        for (let screenY = 0; screenY < geo.visibleLines; screenY++) {
            const viewLine = geo.scrollTop + screenY;
            if (viewLine >= geo.viewLineCount) break;
            const logLine = this.viewState.visualToLogicalLine(viewLine);
            screenYByLogical.set(logLine, screenY);
            if (minLog < 0) minLog = logLine;
            maxLog = logLine;
        }
        if (maxLog < 0) return;

        // Active guide: the innermost region enclosing the cursor. `regions` is
        // sorted by startLine and enclosing regions are strictly nested, so the
        // last one that encloses the cursor line is the innermost.
        let activeRegion: IFoldingRegion | null = null;
        for (const region of regions) {
            if (region.startLine <= primaryLine && primaryLine <= region.endLine) {
                activeRegion = region;
            }
        }

        const guideFg = this.styles.indentGuideForeground;
        const activeFg = this.styles.indentGuideActiveForeground;

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
                // Never paint over code: the header's column is only whitespace on
                // this body line if the line is indented deeper. Blank lines (-1)
                // carry the guide through, as in VS Code.
                const bodyIndent = computeIndentLevel(doc.getLineContent(logLine), tabSize);
                if (bodyIndent !== -1 && bodyIndent <= col) continue;
                context.setCell(screenX, screenY, { char: INDENT_GUIDE, fg, bg: editorBg });
            }
        }
    }

    /**
     * Paints a solid background colour over the cells covered by `range` within
     * the visible viewport. Only `bg` is set, so the glyph and fg underneath are
     * preserved. Used by both the selection and search-match highlight passes.
     */
    private paintRangeBackground(context: RenderContext, range: IRange, bg: number, geo: RangeHighlightGeometry): void {
        this.forEachRangeCell(range, geo, (screenX, screenY) => {
            context.setCell(screenX, screenY, { bg });
        });
    }

    /**
     * Paints a diagnostic squiggle over the cells covered by a marker: sets the
     * severity foreground colour and an undercurl (SGR 4:3, wavy underline).
     * Terminals without undercurl support still show the colour, keeping the
     * marker visible. `bg` is left untouched so a selection/find highlight under
     * the squiggle survives.
     */
    private paintMarkerDecoration(
        context: RenderContext,
        decoration: IMarkerDecoration,
        geo: RangeHighlightGeometry,
    ): void {
        const fg = this.severityForeground(decoration.severity);
        this.forEachRangeCell(decoration.range, geo, (screenX, screenY) => {
            context.setCell(screenX, screenY, { fg, style: StyleFlags.Undercurl });
        });
    }

    /**
     * Walks every screen cell covered by `range` within the visible viewport and
     * invokes `visit(screenX, screenY)` (absolute grid coordinates). Shared by the
     * background-highlight and diagnostic-squiggle passes so the viewport/column
     * math lives in one place.
     */
    private forEachRangeCell(
        range: IRange,
        geo: RangeHighlightGeometry,
        visit: (screenX: number, screenY: number) => void,
    ): void {
        for (let screenY = 0; screenY < geo.visibleLines; screenY++) {
            const viewLine = geo.scrollTop + screenY;
            if (viewLine >= geo.viewLineCount) break;

            const logLine = this.viewState.visualToLogicalLine(viewLine);
            if (logLine < range.start.line || logLine > range.end.line) continue;

            const lineContent = this.viewState.getViewLine(viewLine);
            const dl = this.viewState.displayLineFor(lineContent);
            const startChar = logLine === range.start.line ? range.start.character : 0;
            const endChar = logLine === range.end.line ? range.end.character : lineContent.length + 1;

            const startCol = logLine === range.start.line ? dl.offsetToColumn(startChar) : 0;
            const endCol = logLine === range.end.line ? dl.offsetToColumn(endChar) : dl.displayWidth + 1;

            const screenXStart = Math.max(0, startCol - geo.scrollLeft);
            const screenXEnd = Math.min(geo.contentCols, endCol - geo.scrollLeft);

            for (let screenX = screenXStart; screenX < screenXEnd; screenX++) {
                visit(geo.gutterW + screenX, screenY);
            }
        }
    }

    private severityForeground(severity: MarkerSeverity): number {
        switch (severity) {
            case MarkerSeverity.Error:
                return this.styles.errorForeground;
            case MarkerSeverity.Warning:
                return this.styles.warningForeground;
            case MarkerSeverity.Info:
                return this.styles.infoForeground;
            case MarkerSeverity.Hint:
                return this.styles.hintForeground;
        }
    }

    /**
     * Ranges of every occurrence of the word under the primary cursor. Empty
     * when disabled or when the primary selection is not collapsed (no
     * highlight while text is selected — that mirrors VS Code, where a
     * selection switches to the separate selection-highlight feature).
     *
     * Cached by document version + caret position so re-renders triggered by
     * unrelated changes don't rescan the document.
     */
    private getOccurrenceHighlights(): readonly IRange[] {
        if (!this.occurrenceHighlightEnabled) return NO_RANGES;
        const primary = this.viewState.selections[0];
        if (!isSelectionCollapsed(primary)) return NO_RANGES;

        const doc = this.viewState.document;
        const pos = primary.active;
        const cache = this.occurrenceCache;
        if (
            cache !== null &&
            cache.versionId === doc.versionId &&
            cache.line === pos.line &&
            cache.character === pos.character
        ) {
            return cache.ranges;
        }

        const ranges = computeWordOccurrences(doc, pos);
        this.occurrenceCache = { versionId: doc.versionId, line: pos.line, character: pos.character, ranges };
        return ranges;
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

    // Whether the mouse is currently over the gutter. Expanded regions show their
    // fold chevron only while this holds (à la VS Code `showFoldingControls:
    // "mouseover"`); collapsed regions always show theirs. See render().
    private foldGutterHovered = false;

    private setFoldGutterHovered(value: boolean): void {
        if (this.foldGutterHovered === value) return;
        this.foldGutterHovered = value;
        this.markDirty();
    }

    private screenToDocPosition(localX: number, localY: number): { line: number; character: number } {
        const gutterW = this.gutterWidth;
        const viewLineCount = this.viewState.getViewLineCount();
        /* v8 ignore start -- unreachable: a TextDocument always has at least one line and a fold header is never hidden, so getViewLineCount() is never 0 */
        if (viewLineCount === 0) return { line: 0, character: 0 };
        /* v8 ignore stop */

        const viewLine = Math.min(this.viewState.scrollTop + localY, viewLineCount - 1);
        const logLine = this.viewState.visualToLogicalLine(viewLine);
        const displayCol = localX < gutterW ? 0 : localX - gutterW + this.viewState.scrollLeft;
        const lineContent = this.viewState.document.getLineContent(logLine);
        const dl = this.viewState.displayLineFor(lineContent);
        const charOffset = dl.columnToOffset(displayCol);
        return { line: logLine, character: charOffset };
    }

    private handleMouseDown(event: TUIMouseEvent): void {
        if (event.button === "right") {
            this.openContextMenu(event.screenX, event.screenY);
            return;
        }
        /* v8 ignore start -- unreachable: getViewLineCount() is never 0 (document always has a line; fold headers stay visible) */
        if (this.viewState.getViewLineCount() === 0) return;
        /* v8 ignore stop */

        // Click on the folding control column toggles the region on that line.
        if (this.tryToggleFoldAtGutter(event.localX, event.localY)) {
            this.markDirty();
            return;
        }

        const pos = this.screenToDocPosition(event.localX, event.localY);

        if (event.shiftKey && this.viewState.selections.length > 0) {
            const anchor = this.viewState.selections[0].anchor;
            this.dragAnchor = { line: anchor.line, character: anchor.character };
            this.viewState.selections = [createSelection(anchor.line, anchor.character, pos.line, pos.character)];
        } else {
            this.dragAnchor = { line: pos.line, character: pos.character };
            this.viewState.selections = [createCursorSelection(pos.line, pos.character)];
        }
    }

    /**
     * Double click selects the word under the cursor (VS Code behaviour). The
     * preceding mousedown has already collapsed the selection to a caret here, so
     * this only has to widen it.
     */
    private handleDoubleClick(event: TUIMouseEvent): void {
        if (event.button !== "left") return;
        // The gutter is not text: screenToDocPosition would clamp to column 0 and
        // select the line's first word, which is not what was clicked.
        if (event.localX < this.gutterWidth) return;

        const pos = this.screenToDocPosition(event.localX, event.localY);
        const lineContent = this.viewState.document.getLineContent(pos.line);
        const word = findWordRangeAt(lineContent, pos.character);
        if (word === null) return; // whitespace or punctuation — leave the caret alone

        this.dragAnchor = null;
        this.viewState.selections = [createSelection(pos.line, word.start, pos.line, word.end)];
    }

    /**
     * If `(localX, localY)` lands on the folding control column of a foldable
     * header line, toggles that region and returns true. Returns false otherwise
     * (so the caller falls back to normal cursor placement).
     */
    private tryToggleFoldAtGutter(localX: number, localY: number): boolean {
        if (localX !== this.foldControlColumn) return false;

        const viewLine = this.viewState.scrollTop + localY;
        if (viewLine < 0 || viewLine >= this.viewState.getViewLineCount()) return false;

        const logLine = this.viewState.visualToLogicalLine(viewLine);
        const region = this.viewState.foldedRegions.find((r) => r.startLine === logLine);
        if (region === undefined) return false;

        this.viewState.toggleFold(logLine);
        return true;
    }

    /**
     * Открывает контекстное меню с клавиатуры (Shift+F10), заякорив его на каретке.
     * Если каретка вне видимой области, {@link getCaretScreenCell} вернёт `null` —
     * тогда якоримся в левый верхний угол редактора.
     */
    public openContextMenuAtCaret(): void {
        const anchor = this.getCaretScreenCell() ?? this.globalPosition;
        this.openContextMenu(anchor.x, anchor.y);
    }

    private openContextMenu(screenX: number, screenY: number): void {
        this.closeContextMenu();
        const entries = this.contextMenuProvider?.() ?? this.contextMenuEntries;
        if (entries.length === 0) return;

        const wrappedEntries: MenuEntry[] = entries.map((entry) => {
            if (entry.type === "separator") return entry;
            const original = entry.onSelect;
            return {
                ...entry,
                onSelect: () => {
                    this.closeContextMenu();
                    original?.();
                },
            };
        });

        const menu = new PopupMenuElement(wrappedEntries);
        menu.setStyles(this.styles.menu);

        const layer = this.getOverlayLayer();
        if (!layer) return;

        let session: OverlaySessionHandle | null = null;
        session = layer.createSession(menu, new Point(screenX, screenY), {
            visible: true,
            closeOnEscape: true,
            pointerPolicy: "close-on-outside",
            focusOnOpen: true,
            disposeOnClose: true,
            onClose: () => {
                /* v8 ignore start -- the `!==` else is unreachable: openContextMenu disposes (not closes) any prior session before reassigning, so a session's onClose only fires while it is still the active one */
                if (this.activeContextMenuSession === session) {
                    this.activeContextMenuSession = null;
                }
                /* v8 ignore stop */
            },
        });

        menu.onClose = () => {
            session.close();
        };

        this.activeContextMenuSession = session;
    }

    private closeContextMenu(): void {
        if (!this.activeContextMenuSession) return;
        const session = this.activeContextMenuSession;
        this.activeContextMenuSession = null;
        session.dispose();
    }

    private getOverlayLayer() {
        const root = this.getRoot();
        if (!root) return null;
        return (root as BodyElement).overlayLayer;
    }

    private handleMouseMove(event: TUIMouseEvent): void {
        // Reveal expanded fold chevrons whenever the mouse is over the gutter.
        this.setFoldGutterHovered(event.localX >= 0 && event.localX < this.gutterWidth);

        if (this.dragAnchor === null) return;
        /* v8 ignore start -- unreachable: getViewLineCount() is never 0 (document always has a line; fold headers stay visible) */
        if (this.viewState.getViewLineCount() === 0) return;
        /* v8 ignore stop */

        const pos = this.screenToDocPosition(event.localX, event.localY);
        this.viewState.selections = [
            createSelection(this.dragAnchor.line, this.dragAnchor.character, pos.line, pos.character),
        ];
    }

    private handleKeyPress(event: TUIKeyboardEvent): void {
        if (event.key === "Enter") {
            this.pushUndo(this.viewState.insertNewLine());
            return;
        }

        // Printable character: single char, no ctrl/alt/meta modifiers
        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
            this.pushUndo(this.viewState.type(event.key));
            return;
        }
    }

    private handlePaste(event: TUIPasteEvent): void {
        // Insert the whole paste as one edit (newlines preserved) — one undo step.
        this.pushUndo(this.viewState.insertText(event.text));
    }

    private pushUndo(element: IUndoElement | undefined): void {
        // `undefined` — правка не состоялась: в read-only мутаторы `EditorViewState`
        // сразу возвращают его, и записывать в undo-стек нечего.
        if (element) {
            this.undoManager.pushUndoElement(element);
        }
    }
}

/** Экспортирован для переиспользования в `diffViewElement` — подсветка там та же. */
export function packStyleFlags(style: ResolvedTokenStyle): number {
    let flags = 0;
    if (style.bold) flags |= StyleFlags.Bold;
    if (style.italic) flags |= StyleFlags.Italic;
    if (style.underline) flags |= StyleFlags.Underline;
    if (style.strikethrough) flags |= StyleFlags.Strikethrough;
    return flags;
}

/**
 * Linear cursor over a sorted token array, optimised for left-to-right
 * scans (which is how the renderer walks columns). Falls back to binary
 * search when the offset rewinds.
 *
 * Exported for unit testing: the renderer only ever scans forward, so the
 * rewind path is unreachable through rendering alone.
 */
export class TokenIndex {
    private readonly tokens: readonly IToken[];
    private readonly lineLength: number;
    private cursor = 0;

    public constructor(lineTokens: ILineTokens, lineLength: number) {
        this.tokens = lineTokens.tokens;
        this.lineLength = lineLength;
    }

    /** Token covering `[token.startIndex .. nextToken.startIndex)` for `offset`. */
    public tokenAt(offset: number): IToken | undefined {
        if (this.tokens.length === 0 || offset >= this.lineLength) return undefined;

        // Fast path: forward scan.
        let i = this.cursor;
        if (i >= this.tokens.length || this.tokens[i].startIndex > offset) {
            i = 0; // rewind
        }
        while (i + 1 < this.tokens.length && this.tokens[i + 1].startIndex <= offset) {
            i++;
        }
        this.cursor = i;
        return this.tokens[i];
    }
}
