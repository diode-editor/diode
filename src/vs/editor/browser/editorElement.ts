import { packRgb } from "@tuidom/core/common/colorUtils";
import type { DisplayLine } from "@tuidom/core/common/displayLine";
import { Point } from "@tuidom/core/common/geometryPromitives";
import type { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { TUIPasteEvent } from "@tuidom/core/dom/events/tuiPasteEvent";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import type { IScrollable } from "@tuidom/elements/scrollbar/iScrollable";
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
import type { ITokenStyleResolver, ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../common/languages/iTokenStyleResolver.ts";
import type { IExternalDecorations, IViewZoneDecoration } from "../common/model/iEditorDecoration.ts";
import { EMPTY_EXTERNAL_DECORATIONS } from "../common/model/iEditorDecoration.ts";
import type { IGutterChangeDecoration } from "../common/model/iGutterChangeDecoration.ts";
import type { IUndoElement } from "../common/model/iUndoElement.ts";
import { UndoManager } from "../common/model/undoManager.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { LineWidthCache } from "../common/viewModel/lineWidthCache.ts";
import { LONG_LINE_TRUNCATION_BADGE } from "../common/viewModel/longLineRendering.ts";
import { computeWordOccurrences } from "../contrib/find/computeWordOccurrences.ts";
import { computeIndentLevel } from "../contrib/folding/foldingRangeProvider.ts";
import type { IFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import type { ITextViewportGeometry } from "./textViewRendering.ts";
import {
    caretLocalCell,
    docPositionAt,
    forEachRangeCell,
    paintCarets,
    paintRangeBackground,
    paintTextLine,
    SELECTION_BG,
} from "./textViewRendering.ts";
import { TokenIndex } from "./tokenIndex.ts";

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

// Indentation guide: a vertical line drawn over a region's leading whitespace,
// spanning the region's body.
const INDENT_GUIDE = "│"; // U+2502 box drawings light vertical

/**
 * Специализированные цвета редактора (гуттер, подсветки, squiggles, контекстное
 * меню). Основные fg/bg редактора сюда не входят — они задаются через
 * `editor.style = { fg, bg }` (система наследования TUIStyle).
 */
/**
 * TUI element that renders a text editor backed by EditorViewState.
 * Handles keyboard input (printable chars, Enter, Backspace, Delete)
 * and draws the document content with a hardware cursor.
 */
export class EditorElement extends TUIElement implements IScrollable {
    public readonly viewState: EditorViewState;
    /**
     * Движок undo. По умолчанию — собственный (standalone-редакторы, демо, дифф);
     * редактор файла получает сюда общий менеджер своего документа от
     * `EditorComponent` — история одна на документ, сколько бы вью его ни казало.
     */
    public undoManager: UndoManager;
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

    /**
     * Имя токена темы для фона гуттера; `null` — гуттер идёт за фоном самого
     * редактора. Отдельная ручка нужна редакторам со своим фоном (Output живёт
     * на фоне панели): тема вправе прибить `editorGutter.background` к
     * `editor.background` (dark2026), и тогда гуттер остался бы полосой чужого
     * цвета. Владелец вью ставит `null` — см. `EditorComponent.backgroundToken`.
     */
    public gutterBackgroundToken: string | null = "editorGutter.background";

    /** Diagnostic squiggle decorations for the open document (pushed by the controller). */
    public markerDecorations: readonly IMarkerDecoration[] = NO_MARKER_DECORATIONS;
    /** Gutter change-bar decorations (SCM/git dirty-diff) for the open document (pushed by the controller). */
    public gutterChangeDecorations: readonly IGutterChangeDecoration[] = NO_GUTTER_CHANGE_DECORATIONS;
    /** Внешние декорации владельца вью (дифф): фоны строк/диапазонов, маркеры, зоны. */
    public decorations: IExternalDecorations = EMPTY_EXTERNAL_DECORATIONS;

    private lineWidthCache: LineWidthCache | null = null;
    private occurrenceCache: { versionId: number; line: number; character: number; ranges: IRange[] } | null = null;

    public get contentHeight(): number {
        return this.viewState.getViewLineCount();
    }

    public get contentWidth(): number {
        // При переносе контент по построению не шире вьюпорта: горизонтальному
        // скроллбару нечего показывать (политика "auto" гаснет на
        // contentSize <= viewportSize), а maxScrollLeft в handleWheel — ноль.
        if (this.viewState.isWordWrapActive) return this.viewState.viewportWidth;
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
        };
    }

    public get gutterWidth(): number {
        // Logical line count, not view line count: the gutter paints logical
        // line numbers, so folding must not shrink the digit column (a 150-line
        // file folded to <100 view lines would truncate "150" to "15").
        const lineCount = this.viewState.document.lineCount;
        const digitCount = Math.max(1, Math.floor(Math.log10(lineCount)) + 1);
        return GUTTER_LEFT_PADDING + digitCount + this.gutterMarkerColumns + FOLD_GAP_LEFT + 1 + FOLD_GAP_RIGHT;
    }

    /**
     * Колонка под внешние гуттер-маркеры (`-`/`+` диффа) сразу после цифр —
     * появляется только когда маркеры заданы: у обычного редактора гуттер не
     * ширится впустую.
     */
    private get gutterMarkerColumns(): number {
        return (this.decorations.gutterMarkers?.length ?? 0) > 0 ? 1 : 0;
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
        const local = caretLocalCell(this.viewState, this.gutterWidth, this.layoutSize);
        if (local === null) return null;
        return new Point(this.globalPosition.x + local.x, this.globalPosition.y + local.y);
    }

    /**
     * Единственная точка записи размеров вьюпорта во view-state — ДО render:
     * при word wrap от ширины зависит сама проекция, а `contentHeight`
     * (= число рядов вью) читает ScrollBarDecorator в своём layout-проходе.
     * Декоратор решает видимость полос до layout ребёнка, то есть по проекции
     * ПРОШЛОЙ ширины — на смене ширины дозаказываем кадр, и повторный проход с
     * той же шириной сходится (widthChanged=false). Отложенно через microtask:
     * markDirty прямо из layout оставил бы корень layout-грязным после кадра —
     * тот же паттерн, что onDidChangeMode в diffEditorPane2.
     */
    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const textWidth = size.width - this.gutterWidth;
        const changed = this.viewState.viewportWidth !== textWidth || this.viewState.viewportHeight !== size.height;
        this.viewState.viewportWidth = textWidth;
        this.viewState.viewportHeight = size.height;
        if (changed && this.viewState.isWordWrapActive) {
            queueMicrotask(() => this.markDirty());
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

        // Любое движение курсора/правка (печать, paste, мышь, undo, команды —
        // все проходят через сеттер selections) — грязный кадр. Раньше
        // перерисовку спасала лишь побочная цепочка «selections → статус-бар →
        // setText → markDirty», которой нет у standalone-редактора.
        this.viewState.onDidChangeCursorPosition(() => {
            this.markDirty();
        });
        // Видимые изменения мимо курсора — скролл (scrollLine*, колесо),
        // фолдинг, подсветка поиска и правки документа напрямую (applyEdits
        // из расширений/bulkEdit) — тоже обязаны пометить редактор: под
        // damage-tracking непомеченный виджет не перерисовывается.
        this.viewState.onDidChangeView(() => {
            this.markDirty();
        });
        this.viewState.document.onDidChangeContent(() => {
            this.markDirty();
        });

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

        // Внешние декорации — flatten раз за кадр, цвета резолвятся здесь же
        // (styleVar), чтобы строки платили за поиск токена не по разу.
        const lineBgByLine = new Map<number, number>();
        for (const decoration of this.decorations.lineBackgrounds ?? []) {
            const bg = this.styleVar(decoration.colorToken);
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

        // Bring the token cache up to the bottom of the viewport before reading.
        const tokenStore = this.viewState.tokenStore;
        if (tokenStore && visibleLines > 0) {
            // Нижняя строка вьюпорта может быть зоной (у неё документной нет) —
            // прогреваем до ближайшей документной, иначе подсветка хвоста
            // вьюпорта молча отстанет. docLineForViewLine всегда отдаёт
            // валидную строку — гард не нужен.
            tokenStore.tokenizeUpTo(
                this.viewState.docLineForViewLine(Math.min(scrollTop + visibleLines - 1, viewLineCount - 1)),
            );
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

        // Кадровый мемо DisplayLine по документной строке: при wrap N фрагментов
        // одной строки не должны сегментировать её N раз (тот же приём, что
        // displayLineByDocLine в paintCarets).
        const dlByDocLine = new Map<number, DisplayLine>();

        for (let screenY = 0; screenY < visibleLines; screenY++) {
            const viewLine = scrollTop + screenY;

            // --- View zone row: виртуальная строка без документной — пустой
            // гуттер и контент от владельца зон (филлеры, плашки, а с
            // многострочными `lines` — призраки inline-диффа). Номера строк
            // не тратит.
            const zoneRow = this.viewState.zoneRowForViewLine(viewLine);
            if (zoneRow !== null) {
                for (let x = 0; x < gutterW; x++) {
                    context.setCell(x, screenY, { char: " ", bg: gutBg });
                }
                const zoneDecoration = zoneDecorationByAnchor.get(zoneRow.anchor);
                const zoneLine = zoneDecoration?.lines?.[zoneRow.offset];
                const zoneFg =
                    zoneLine?.colorToken !== undefined
                        ? this.styleVar(zoneLine.colorToken)
                        : zoneDecoration?.colorToken !== undefined
                          ? this.styleVar(zoneDecoration.colorToken)
                          : editorFg;
                const zoneBg = zoneLine?.bgToken !== undefined ? this.styleVar(zoneLine.bgToken) : editorBg;
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

            // Фрагмент строки, который несёт этот ряд; ряд-продолжение (start > 0)
            // не повторяет номер строки, chevron и маркеры — они у первого ряда.
            const frag = this.viewState.viewLineRange(viewLine);
            const isContinuation = frag.start > 0;

            // --- Gutter ---
            if (viewLine < viewLineCount) {
                const logLine = this.viewState.visualToLogicalLine(viewLine);
                const lineNumStr = isContinuation
                    ? " ".repeat(digitCount)
                    : String(logLine + 1).padStart(digitCount, " ");
                const isActive = logLine === primaryLine;
                const numFg = isActive ? lnActiveFg : lnFg;
                // Фон диффовой строки идёт и под номером (как в VS Code) —
                // декорация строки перекрывает фон гуттера.
                const rowGutBg = lineBgByLine.get(logLine) ?? gutBg;

                // Left padding
                for (let x = 0; x < GUTTER_LEFT_PADDING; x++) {
                    context.setCell(x, screenY, { char: " ", fg: numFg, bg: rowGutBg });
                }
                // Line number digits
                for (let d = 0; d < digitCount; d++) {
                    context.setCell(GUTTER_LEFT_PADDING + d, screenY, { char: lineNumStr[d], fg: numFg, bg: rowGutBg });
                }
                // Fold control column plus a blank gap before the text (the gap
                // also separates the line number from the content). On a foldable
                // header line the control shows a chevron (down = expanded, right
                // = collapsed).
                const foldCol = this.foldControlColumn;
                for (let x = GUTTER_LEFT_PADDING + digitCount; x < gutterW; x++) {
                    context.setCell(x, screenY, { char: " ", fg: numFg, bg: rowGutBg });
                }
                // Внешний гуттер-маркер (`-`/`+` диффа) — в своей колонке сразу
                // после цифр (колонка существует, только когда маркеры заданы).
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
                // Change bar in the left fold column (immediately left of the
                // chevron), painted after the fold-area blanks so it survives.
                // Modified lines get a dashed bar (VS Code dirty-diff style).
                const change = gutterChangeByLine.get(logLine);
                if (change !== undefined && !isContinuation) {
                    const char = change.dashed ? GUTTER_CHANGE_BAR_DASHED : GUTTER_CHANGE_BAR;
                    context.setCell(foldCol - 1, screenY, { char, fg: change.color, bg: rowGutBg });
                }
                const foldState = isContinuation ? undefined : foldHeaderByLine.get(logLine);
                // Collapsed regions always show their chevron; expanded ones only
                // while the gutter is hovered (VS Code `showFoldingControls`).
                const showChevron = foldState === true || (foldState === false && this.foldGutterHovered);
                if (showChevron) {
                    const icon = foldState ? FOLD_ICON_COLLAPSED : FOLD_ICON_EXPANDED;
                    context.setCell(foldCol, screenY, { char: icon, fg: foldFg, bg: rowGutBg });
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
            const rowLogLine = this.viewState.visualToLogicalLine(viewLine);
            let dl = dlByDocLine.get(rowLogLine);
            if (dl === undefined) {
                dl = this.viewState.displayLineFor(lineContent);
                dlByDocLine.set(rowLogLine, dl);
            }
            const lineTokens = this.viewState.getViewLineTokens(viewLine);
            const tokenIndex = lineTokens ? new TokenIndex(lineTokens, lineContent.length) : null;
            // Колоночное окно фрагмента в целой строке; у последнего фрагмента
            // правой границы нет — за концом строки и так рисуются пробелы.
            const isLastFragment = frag.end === lineContent.length;
            const fragStartCol = isContinuation ? dl.offsetToColumn(frag.start) : 0;

            // Фон декорированной строки должен побеждать фон токена, иначе
            // полоса added/removed рвётся на подсвеченных словах (та же
            // политика, что у диффовой смотрелки).
            const decoratedBg = lineBgByLine.get(rowLogLine);
            paintTextLine(context, {
                displayLine: dl,
                tokenIndex,
                resolveStyle,
                screenY,
                gutterW,
                contentCols,
                scrollLeft,
                startColumn: fragStartCol,
                endColumnExclusive: isLastFragment ? undefined : dl.offsetToColumn(frag.end),
                fg: editorFg,
                bg: decoratedBg ?? editorBg,
                allowTokenBg: decoratedBg === undefined,
            });

            // Extremely long line: rendering stopped at STOP_RENDERING_LINE_AFTER.
            // Draw a labelled "Long line trimmed" button at the cut point when it
            // is on screen, painted as a warning plaque (dark text on the warning
            // colour) so the truncation is obvious rather than silent. При wrap
            // плашка — на последнем фрагменте, где и лежит точка обрыва.
            if (dl.isTruncated && isLastFragment) {
                let badgeStartCol = dl.displayWidth - scrollLeft - fragStartCol;
                // При wrap скролла вправо нет, а жёсткая резка кладёт точку
                // обрыва ровно на ширину фрагмента — прижимаем плашку в видимую
                // область, поверх хвоста последнего фрагмента.
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

            // Collapsed region: draw a marker after the header line's content,
            // standing in for the hidden body (VS Code's inline "⋯"). При wrap —
            // после конца текста, то есть на последнем фрагменте заголовка.
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

        // Shared geometry for the range-background highlight passes below.
        const geometry: ITextViewportGeometry = {
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

        // Intra-line подсветка диффа: яркий фон изменённого фрагмента поверх
        // фона строки; слабее occurrence/selection — те побеждают в наложении.
        for (const decoration of this.decorations.rangeBackgrounds ?? []) {
            paintRangeBackground(
                context,
                this.viewState,
                decoration.range,
                this.styleVar(decoration.colorToken),
                geometry,
            );
        }

        // Highlight all occurrences of the word under the cursor (weakest layer,
        // painted first so selections and search matches win where they overlap).
        const occurrenceBg = this.styleVar("editor.wordHighlightBackground");
        for (const range of this.getOccurrenceHighlights()) {
            paintRangeBackground(context, this.viewState, range, occurrenceBg, geometry);
        }

        // Highlight all search matches except the current one (drawn under selections).
        const searchMatches = this.viewState.searchMatches;
        const currentMatchIndex = this.viewState.currentSearchMatchIndex;
        for (let i = 0; i < searchMatches.length; i++) {
            if (i === currentMatchIndex) continue;
            paintRangeBackground(context, this.viewState, searchMatches[i], FIND_MATCH_BG, geometry);
        }

        // Highlight selections
        for (const sel of this.viewState.selections) {
            if (isSelectionCollapsed(sel)) continue;
            paintRangeBackground(context, this.viewState, selectionToRange(sel), SELECTION_BG, geometry);
        }

        // Highlight the current search match on top (wins over other matches and selection).
        if (currentMatchIndex >= 0 && currentMatchIndex < searchMatches.length) {
            paintRangeBackground(
                context,
                this.viewState,
                searchMatches[currentMatchIndex],
                FIND_MATCH_CURRENT_BG,
                geometry,
            );
        }

        // Diagnostic squiggles on top of the content — painted last (after the
        // background passes) so the severity colour and undercurl win.
        for (const decoration of this.markerDecorations) {
            this.paintMarkerDecoration(context, decoration, geometry);
        }

        // Каретки ячейками — самый верхний слой (как `.cursors-layer` в VS Code): бьют и
        // выделение, и search-match, и squiggle. Рисуем ТОЛЬКО в мультикурсоре, и сразу все,
        // включая первичную: `gridToSvg` игнорирует аппаратный курсор, поэтому иначе демо-кадр
        // показывал бы на одну каретку меньше и дыру на месте первичной. При одном курсоре
        // картинка остаётся прежней — его рисует сам терминал.
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

        // Position hardware cursor at the primary selection's active position
        const caret = caretLocalCell(this.viewState, gutterW, this.layoutSize);
        if (this.isFocused && caret !== null) {
            context.setCursorPosition(caret.x, caret.y);
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
        geo: ITextViewportGeometry,
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
            // Строка-зона: документной строки нет — гайды через неё не рисуем
            // (сентинел -1 сломал бы и мапу, и min/max).
            if (logLine < 0) continue;
            // Ряд-продолжение wrap: гайд лёг бы поверх текста — продолжения
            // начинаются с колонки 0 (wrappingIndent не реализован).
            if (this.viewState.viewLineRange(viewLine).start > 0) continue;
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
     * Paints a diagnostic squiggle over the cells covered by a marker: sets the
     * severity foreground colour and an undercurl (SGR 4:3, wavy underline).
     * Terminals without undercurl support still show the colour, keeping the
     * marker visible. `bg` is left untouched so a selection/find highlight under
     * the squiggle survives.
     */
    private paintMarkerDecoration(
        context: RenderContext,
        decoration: IMarkerDecoration,
        geo: ITextViewportGeometry,
    ): void {
        const fg = this.severityForeground(decoration.severity);
        forEachRangeCell(this.viewState, decoration.range, geo, (screenX, screenY) => {
            context.setCell(screenX, screenY, { fg, style: StyleFlags.Undercurl });
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
     * Ranges of every occurrence of the word under the primary cursor. Empty
     * when disabled or when the primary selection is not collapsed (no
     * highlight while text is selected — that mirrors VS Code, where a
     * selection switches to the separate selection-highlight feature).
     *
     * В мультикурсоре подсветки нет вовсе: она отвечает на вопрос «где ещё встречается
     * слово под кареткой», а при нескольких каретках такого слова не одно — фон дрался бы
     * с выделениями «выделить следующее вхождение».
     *
     * Cached by document version + caret position so re-renders triggered by
     * unrelated changes don't rescan the document.
     */
    private getOccurrenceHighlights(): readonly IRange[] {
        if (!this.occurrenceHighlightEnabled) return NO_RANGES;
        if (this.viewState.selections.length !== 1) return NO_RANGES;
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

    /**
     * Документная позиция под локальной точкой (клики контроллеров: контекстное
     * меню ставит каретку на позицию клика). Клик по гуттеру маппится в колонку 0.
     */
    public docPositionAt(localX: number, localY: number): { line: number; character: number } {
        return docPositionAt(this.viewState, this.gutterWidth, localX, localY);
    }

    private handleMouseDown(event: TUIMouseEvent): void {
        // Правый клик каретку не трогает сам: политика (двигать ли каретку,
        // открывать ли меню) — у editor/contrib/contextmenu по событию
        // "contextmenu", которое движок диспатчит на отпускании кнопки.
        if (event.button !== "left") return;
        /* v8 ignore start -- unreachable: getViewLineCount() is never 0 (document always has a line; fold headers stay visible) */
        if (this.viewState.getViewLineCount() === 0) return;
        /* v8 ignore stop */

        // Click on the folding control column toggles the region on that line.
        if (this.tryToggleFoldAtGutter(event.localX, event.localY)) {
            this.markDirty();
            return;
        }

        const pos = this.docPositionAt(event.localX, event.localY);

        // Alt+клик ставит или снимает каретку (VS Code `multiCursorModifier: "alt"`).
        // Раньше shift-ветки: Shift+Alt+клик — не мультикурсорный жест, а расширение выделения.
        if (event.altKey && !event.shiftKey) {
            this.dragAnchor = null; // alt+drag выделение не тянет
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

    /**
     * Double click selects the word under the cursor (VS Code behaviour). The
     * preceding mousedown has already collapsed the selection to a caret here, so
     * this only has to widen it.
     */
    private handleDoubleClick(event: TUIMouseEvent): void {
        if (event.button !== "left") return;
        // The gutter is not text: docPositionAt would clamp to column 0 and
        // select the line's first word, which is not what was clicked.
        if (event.localX < this.gutterWidth) return;

        const pos = this.docPositionAt(event.localX, event.localY);
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

    private handleMouseMove(event: TUIMouseEvent): void {
        // Reveal expanded fold chevrons whenever the mouse is over the gutter.
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
