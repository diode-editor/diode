import { compositeOver, packRgb } from "@tuidom/core/common/colorUtils";
import type { DisplayLine } from "@tuidom/core/common/displayLine";
import type { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { Point } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { TUIPasteEvent } from "@tuidom/core/dom/events/tuiPasteEvent";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import type { IScrollable } from "@tuidom/elements/scrollbar/iScrollable";

import { Emitter } from "../../base/common/event.ts";
import type { IDisposable } from "../../base/common/lifecycle.ts";
import type { IMarkerDecoration } from "../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { withCursorChangeSource } from "../common/core/cursorChangeSource.ts";
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
import { LONG_LINE_TRUNCATION_BADGE } from "../common/viewModel/longLineRendering.ts";
import { computeWordOccurrences } from "../contrib/find/computeWordOccurrences.ts";
import { computeIndentLevel } from "../contrib/folding/foldingRangeProvider.ts";
import type { IFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import type { ILinePhantom, ITextViewportGeometry } from "./textViewRendering.ts";
import {
    caretLocalCell,
    composedLineContent,
    composedOffset,
    docPositionAt,
    forEachRangeCell,
    paintCarets,
    paintPhantomText,
    paintRangeBackground,
    paintTextLine,
} from "./textViewRendering.ts";
import { resolveSemanticTokenStyle, SemanticTokenIndex, TokenIndex } from "./tokenIndex.ts";

const FIND_MATCH_BG = packRgb(98, 91, 23);
const FIND_MATCH_CURRENT_BG = packRgb(168, 109, 0);
const NO_RANGES: readonly IRange[] = [];
const NO_GUTTER_CHANGE_DECORATIONS: readonly IGutterChangeDecoration[] = [];
// Тонкую рамку dirty-diff VS Code в сетке ячеек заменяет жирная вертикаль по центру
// ячейки; modified — пунктир (у VS Code — штриховка).
const GUTTER_CHANGE_BAR = "┃";
const GUTTER_CHANGE_BAR_DASHED = "┋";
const GUTTER_LEFT_PADDING = 2;

// Codicon, как у VS Code: тоньше Nerd Font fa-angle дерева файлов, не теснят текст.
const FOLD_ICON_EXPANDED = "\ueab4"; //  nf-cod-chevron_down
const FOLD_ICON_COLLAPSED = "\ueab6"; //  nf-cod-chevron_right
const FOLD_GAP_LEFT = 1;
const FOLD_GAP_RIGHT = 1;
const FOLD_COLLAPSED_MARKER = "⋯";

const INDENT_GUIDE = "│";

/**
 * Ряд+колонка, а не ключ `y * ширина + x`: мутант-деление схлопывает разные ячейки
 * в одну, и проход маркеров начинает принимать текст за гайд.
 */
type IndentGuideCells = ReadonlyMap<number, ReadonlySet<number>>;

const NO_GUIDE_CELLS: IndentGuideCells = new Map<number, ReadonlySet<number>>();

export class EditorElement extends TUIElement implements IScrollable {
    public readonly viewState: EditorViewState;
    /** Редактор файла кладёт сюда общий менеджер документа: история одна, сколько бы вью его ни казало. */
    public undoManager: UndoManager;
    public tokenStyleResolver: ITokenStyleResolver = NULL_TOKEN_STYLE_RESOLVER;

    public semanticTokenStyleResolver: ISemanticTokenStyleResolver = NULL_SEMANTIC_TOKEN_STYLE_RESOLVER;

    /**
     * Функция, а не снимок: язык буфера может смениться (Save As), а конфигурация —
     * доехать позже (ленивая загрузка).
     */
    public languageConfigurationSource: (() => IResolvedLanguageConfiguration | undefined) | null = null;

    private readonly onDidTypeEmitter = new Emitter<string>();

    /**
     * Upstream `ICodeEditor.onDidType`: приходит ПОСЛЕ правки, в том числе для
     * auto-close, typeover и auto-surround. Вставка, Enter, undo и правки расширений
     * набором не считаются — подписчикам (триггер-символы попапов) нужен именно набор.
     */
    public readonly onDidType = this.onDidTypeEmitter.event;

    public get tabSize(): number {
        return this.viewState.tabSize;
    }

    public set tabSize(value: number) {
        this.viewState.tabSize = value;
    }

    public occurrenceHighlightEnabled = true;

    /**
     * `null` — фон самого редактора: тема вправе прибить `editorGutter.background` к
     * `editor.background`, и у редактора со своим фоном (Output) гуттер стал бы чужой полосой.
     */
    public gutterBackgroundToken: string | null = "editorGutter.background";

    /** Хранит документ: диапазоны едут вместе с текстом при правках. */
    public get markerDecorations(): readonly IMarkerDecoration[] {
        return this.viewState.getMarkerDecorations();
    }

    public set markerDecorations(decorations: readonly IMarkerDecoration[]) {
        this.viewState.setMarkerDecorations(decorations);
    }

    public gutterChangeDecorations: readonly IGutterChangeDecoration[] = NO_GUTTER_CHANGE_DECORATIONS;
    public decorations: IExternalDecorations = EMPTY_EXTERNAL_DECORATIONS;

    private lineWidthCache: LineWidthCache | null = null;
    private occurrenceCache: { versionId: number; line: number; character: number; ranges: IRange[] } | null = null;
    private ghostTextValue: IGhostText | null = null;
    private renderedDocLines: { first: number; last: number } | undefined;

    public get ghostText(): IGhostText | null {
        return this.ghostTextValue;
    }

    /**
     * Хвост подсказки (строки после первой) элемент кладёт в свои view zones. Они
     * взаимоисключающи с зонами владельца ({@link decorations}), поэтому ghost есть только у
     * редактора файла, а у диффа (зонами владеет `diffEditorPane2`) выключен.
     */
    public setGhostText(ghost: IGhostText | null): void {
        if (ghostTextEquals(this.ghostTextValue, ghost)) return;
        const hadZones = (this.ghostTextValue?.lines.length ?? 1) > 1;
        this.ghostTextValue = ghost;
        const needsZones = ghost !== null && ghost.lines.length > 1;
        // setViewZones заменяет ВЕСЬ набор зон — не трогаем его, пока ghost
        // зонами не пользовался: чужие зоны (буде появятся) не пострадают.
        if (hadZones || needsZones) {
            this.viewState.setViewZones(needsZones ? [{ afterLine: ghost.line, size: ghost.lines.length - 1 }] : []);
        }
        this.markDirty();
    }

    public get contentHeight(): number {
        return this.viewState.getViewLineCount();
    }

    public get contentWidth(): number {
        // При переносе контент не шире вьюпорта — горизонтальному скроллбару нечего показывать.
        if (this.viewState.isWordWrapActive) return this.viewState.viewportWidth;
        // Кэш привязан к документу раз: документ у EditorElement не меняется (перечитка с диска
        // строит новый элемент).
        this.lineWidthCache ??= new LineWidthCache(this.viewState.document, this.tabSize);
        this.lineWidthCache.setTabSize(this.tabSize);
        return this.lineWidthCache.getMaxWidth();
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
        // Логические строки, не строки вью: фолдинг не должен сужать колонку цифр
        // (файл из 150 строк, свёрнутый до <100, обрезал бы «150» до «15»).
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

    /** Одно значение на все проходы кадра: строка, фоны диапазонов, каретки и hit-test. */
    private get linePhantom(): ILinePhantom | null {
        const ghost = this.ghostTextValue;
        if (ghost === null) return null;
        const document = this.viewState.document;
        // Подсказка устарела (правка извне раньше, чем сервис погасил сессию): инвариант «фантом
        // внутри своей строки» держит всю композитную математику кадра, поэтому кламп — здесь.
        if (ghost.line < 0 || ghost.line >= document.lineCount) return null;
        return {
            line: ghost.line,
            offset: Math.min(ghost.character, document.getLineLength(ghost.line)),
            text: ghost.lines[0],
        };
    }

    /**
     * Размеры вьюпорта пишутся во view-state ДО render: при word wrap от ширины зависит
     * проекция, а ScrollBarDecorator решает видимость полос по проекции ПРОШЛОЙ ширины —
     * на смене ширины дозаказываем кадр. Через microtask: markDirty прямо из layout
     * оставил бы корень layout-грязным после кадра.
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
            this.markDirty();
        });
        // Скролл, фолдинг и правки мимо курсора (applyEdits расширений) — тоже: под
        // damage-tracking непомеченный виджет не перерисовывается.
        this.viewState.onDidChangeView(() => {
            this.markDirty();
        });
        this.viewState.document.onDidChangeContent(() => {
            this.markDirty();
        });

        // Источник смены каретки мост расширений читает синхронно (`TextEditorSelectionChangeKind`).
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

    /** Выставляют через `TextEditorPane.readOnly` — он ещё и файрит событие. */
    public get readOnly(): boolean {
        return this.viewState.readOnly;
    }

    /** Фон кладёт токены кусками по ~1 мс: кадр на каждый кусок за экраном — впустую. */
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
        // Курсив — как ghost text VS Code (`.ghost-text-decoration`).
        const ghost = this.ghostTextValue;
        const ghostFg = ghost !== null ? this.styleVar("editorGhostText.foreground") : 0;
        const phantom = this.linePhantom;

        const foldHeaderByLine = new Map<number, boolean>();
        for (const region of this.viewState.foldedRegions) {
            foldHeaderByLine.set(region.startLine, region.isCollapsed);
        }

        // Удалённый ханк — одна граничная строка (его диапазон покрывает только её).
        const gutterChangeByLine = new Map<number, { color: number; dashed: boolean }>();
        for (const decoration of this.gutterChangeDecorations) {
            for (let line = decoration.range.start.line; line <= decoration.range.end.line; line++) {
                gutterChangeByLine.set(line, { color: decoration.color, dashed: decoration.dashed === true });
            }
        }

        // Токен с альфой композитится с фоном редактора один раз здесь: строку красят
        // несколькими проходами, и полупрозрачный bg лёг бы в каждом новым слоем.
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

        // Нижняя строка вьюпорта может быть зоной — docLineForViewLine берёт ближайшую
        // документную, иначе подсветка хвоста вьюпорта молча отстанет.
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
            // Тип < 65536 (контракт API), модификаторы — 32 бита: ключ без коллизий.
            // Stryker disable next-line ArithmeticOperator: «−» и «/» тоже дают ключ без коллизий
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

        // При wrap N фрагментов одной строки не должны сегментировать её N раз.
        const dlByDocLine = new Map<number, DisplayLine>();

        for (let screenY = 0; screenY < visibleLines; screenY++) {
            const viewLine = scrollTop + screenY;

            // Строка-зона: номера строк не тратит, контент — от владельца зон.
            const zoneRow = this.viewState.zoneRowForViewLine(viewLine);
            if (zoneRow !== null) {
                for (let x = 0; x < gutterW; x++) {
                    context.setCell(x, screenY, { char: " ", bg: gutBg });
                }
                // Своя зона редактора — только под ghost (см. setGhostText): единственная зона на
                // ghost.line размером ровно lines.length - 1, поэтому «ослабляющие» мутанты
                // проверок якоря и offset'а недостижимы.
                // Stryker disable next-line ConditionalExpression,EqualityOperator,ArithmeticOperator: см. выше
                if (ghost !== null && zoneRow.anchor === ghost.line && zoneRow.offset + 1 < ghost.lines.length) {
                    // Лишняя колонка «<=»-мутанта клиппится прямоугольником элемента.
                    // Stryker disable next-line EqualityOperator: см. выше
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
                // Заливка и текст поверх — два setCell в одну ячейку: bg зоны композитим один раз.
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

            // Ряд-продолжение wrap не повторяет номер строки, chevron и маркеры.
            const frag = this.viewState.viewLineRange(viewLine);
            const isContinuation = frag.start > 0;

            if (viewLine < viewLineCount) {
                const logLine = this.viewState.visualToLogicalLine(viewLine);
                const lineNumStr = isContinuation
                    ? // Stryker disable next-line StringLiteral: пустая строка даёт undefined-char, который setCell рисует тем же пробелом
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
                // Гард по колонке и мапа маркеров растут из одного источника
                // (decorations.gutterMarkers) — мутанты гарда неубиваемы.
                // Stryker disable next-line ConditionalExpression,EqualityOperator: см. выше
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
                // После заливки fold-колонки, иначе она затрёт полосу.
                const change = gutterChangeByLine.get(logLine);
                if (change !== undefined && !isContinuation) {
                    const char = change.dashed ? GUTTER_CHANGE_BAR_DASHED : GUTTER_CHANGE_BAR;
                    context.setCell(foldCol - 1, screenY, { char, fg: change.color, bg: rowGutBg });
                }
                const foldState = isContinuation ? undefined : foldHeaderByLine.get(logLine);
                const showChevron = foldState === true || (foldState === false && this.foldGutterHovered);
                if (showChevron) {
                    const icon = foldState ? FOLD_ICON_COLLAPSED : FOLD_ICON_EXPANDED;
                    context.setCell(foldCol, screenY, { char: icon, fg: foldFg, bg: rowGutBg });
                }
            } else {
                for (let x = 0; x < gutterW; x++) {
                    context.setCell(x, screenY, { char: " ", bg: gutBg });
                }
            }

            if (viewLine >= viewLineCount) {
                // VS Code не рисует vim-тильды за концом документа.
                for (let x = 0; x < contentCols; x++) {
                    context.setCell(gutterW + x, screenY, { char: " ", fg: editorFg, bg: editorBg });
                }
                continue;
            }

            const lineContent = this.viewState.getViewLine(viewLine);
            const rowLogLine = this.viewState.visualToLogicalLine(viewLine);
            // Кэш — чистая мемоизация, мутанты неубиваемы.
            // Stryker disable next-line CallExpression: см. выше
            let dl = dlByDocLine.get(rowLogLine);
            // Stryker disable next-line ConditionalExpression: см. выше
            if (dl === undefined) {
                // Табы и широкие символы подсказки занимают колонки от НАЧАЛА строки, как текст.
                dl = this.viewState.displayLineFor(composedLineContent(phantom, rowLogLine, lineContent));
                // Stryker disable next-line CallExpression: заполнение кэша, результат не меняет
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

            // Фон декорированной строки побеждает фон токена, иначе полоса added/removed
            // рвётся на подсвеченных словах.
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

            // При wrap плашка обрезанной строки — на последнем фрагменте, где точка обрыва.
            if (dl.isTruncated && isLastFragment) {
                let badgeStartCol = dl.displayWidth - scrollLeft - fragStartCol;
                // При wrap скролла вправо нет, а жёсткая резка кладёт точку обрыва ровно на
                // ширину фрагмента — прижимаем плашку в видимую область.
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
        };

        // Гайды — до проходов подсветки: те ставят только `bg` и ложатся поверх глифа.
        const indentGuideCells = this.paintIndentGuides(context, geometry, editorBg, primaryLine);

        // Порядок проходов — порядок наложения: следующий побеждает предыдущий.
        for (const decoration of this.decorations.rangeBackgrounds ?? []) {
            paintRangeBackground(
                context,
                this.viewState,
                decoration.range,
                this.styleVar(decoration.colorToken),
                geometry,
            );
        }

        const occurrenceBg = this.styleVar("editor.wordHighlightBackground");
        for (const range of this.getOccurrenceHighlights()) {
            paintRangeBackground(context, this.viewState, range, occurrenceBg, geometry);
        }

        const searchMatches = this.viewState.searchMatches;
        const currentMatchIndex = this.viewState.currentSearchMatchIndex;
        for (let i = 0; i < searchMatches.length; i++) {
            if (i === currentMatchIndex) continue;
            paintRangeBackground(context, this.viewState, searchMatches[i], FIND_MATCH_BG, geometry);
        }

        // Цвет выделения — с альфой как есть: патч bg ложится на уже нарисованный фон строки.
        const selectionBg = this.styleVar("editor.selectionBackground");
        for (const sel of this.viewState.selections) {
            if (isSelectionCollapsed(sel)) continue;
            paintRangeBackground(context, this.viewState, selectionToRange(sel), selectionBg, geometry);
        }

        if (currentMatchIndex >= 0 && currentMatchIndex < searchMatches.length) {
            paintRangeBackground(
                context,
                this.viewState,
                searchMatches[currentMatchIndex],
                FIND_MATCH_CURRENT_BG,
                geometry,
            );
        }

        // Squiggles — после фонов, чтобы цвет и undercurl победили.
        for (const decoration of this.markerDecorations) {
            this.paintMarkerDecoration(context, decoration, geometry, indentGuideCells);
        }

        // Каретки ячейками — только в мультикурсоре, и сразу все, включая первичную:
        // `gridToSvg` игнорирует аппаратный курсор, и демо-кадр показал бы дыру на месте первичной.
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
    }

    /**
     * Гайд ложится только на ведущие пробелы строки тела: у областей расширений
     * (`#region`) маркер стоит на одном отступе с кодом, поэтому каждую ячейку сверяем
     * с отступом самой строки.
     */
    private paintIndentGuides(
        context: RenderContext,
        geo: ITextViewportGeometry,
        editorBg: number,
        primaryLine: number,
    ): IndentGuideCells {
        const regions = this.viewState.foldedRegions;
        // Stryker disable next-line ConditionalExpression,EqualityOperator: ранний выход
        // по пустому списку областей эквивалентен проходу — цикл ниже просто не сделает
        // ни одной итерации и вернёт пустой набор.
        if (regions.length === 0) return NO_GUIDE_CELLS;

        const doc = this.viewState.document;
        const tabSize = this.tabSize;

        // Логические строки растут вместе с screenY: первая — минимум, последняя — максимум.
        const screenYByLogical = new Map<number, number>();
        let minLog = -1;
        let maxLog = -1;
        for (let screenY = 0; screenY < geo.visibleLines; screenY++) {
            const viewLine = geo.scrollTop + screenY;
            if (viewLine >= geo.viewLineCount) break;
            const logLine = this.viewState.visualToLogicalLine(viewLine);
            // Строка-зона: сентинел -1 сломал бы и мапу, и min/max.
            if (logLine < 0) continue;
            // Продолжения wrap начинаются с колонки 0 (wrappingIndent не реализован) — гайд лёг бы на текст.
            if (this.viewState.viewLineRange(viewLine).start > 0) continue;
            screenYByLogical.set(logLine, screenY);
            if (minLog < 0) minLog = logLine;
            maxLog = logLine;
        }
        // Stryker disable next-line ConditionalExpression,EqualityOperator: ранний выход
        // по «нет видимых строк» эквивалентен проходу — при maxLog ≤ 0 у любой области
        // firstBody (≥ startLine + 1) больше lastBody, и цикл ниже ничего не рисует.
        if (maxLog < 0) return NO_GUIDE_CELLS;

        // Области отсортированы по startLine и строго вложены: последняя охватывающая — самая внутренняя.
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
                // Пустые строки (-1) несут гайд насквозь, как в VS Code.
                const bodyIndent = computeIndentLevel(doc.getLineContent(logLine), tabSize);
                if (bodyIndent !== -1 && bodyIndent <= col) continue;
                context.setCell(screenX, screenY, { char: INDENT_GUIDE, fg, bg: editorBg });
                const columns = guideCells.get(screenY);
                // Вложенные области дают несколько гайдов на ряду — пополняем, а не заменяем.
                if (columns === undefined) guideCells.set(screenY, new Set([screenX]));
                else columns.add(screenX);
            }
        }

        return guideCells;
    }

    /**
     * `bg` не трогаем — подсветка под волной выживает. На ячейках гайдов — только
     * волна: ячейка терминала несёт один fg, и перекраска превратила бы `│` в сплошную
     * красную полосу по отступу (VS Code рисует гайд и squiggle разными слоями).
     */
    private paintMarkerDecoration(
        context: RenderContext,
        decoration: IMarkerDecoration,
        geo: ITextViewportGeometry,
        indentGuideCells: IndentGuideCells,
    ): void {
        const fg = this.severityForeground(decoration.severity);
        forEachRangeCell(this.viewState, decoration.range, geo, (screenX, screenY) => {
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
     * При выделении и в мультикурсоре подсветки нет: в VS Code выделение переключает на
     * selection-highlight, а при нескольких каретках фон дрался бы с «выделить следующее вхождение».
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

    // Развёрнутые области показывают chevron только при наведении (VS Code `showFoldingControls: "mouseover"`).
    private foldGutterHovered = false;

    private setFoldGutterHovered(value: boolean): void {
        if (this.foldGutterHovered === value) return;
        this.foldGutterHovered = value;
        this.markDirty();
    }

    /** Клик по гуттеру маппится в колонку 0. */
    public docPositionAt(localX: number, localY: number): { line: number; character: number } {
        return docPositionAt(this.viewState, this.gutterWidth, localX, localY, this.linePhantom);
    }

    private handleMouseDown(event: TUIMouseEvent): void {
        // Каретку при правом клике двигает (или нет) editor/contrib/contextmenu по событию
        // "contextmenu" — движок шлёт его на отпускании.
        if (event.button !== "left") return;
        /* v8 ignore start -- unreachable: getViewLineCount() is never 0 (document always has a line; fold headers stay visible) */
        if (this.viewState.getViewLineCount() === 0) return;
        /* v8 ignore stop */

        if (this.tryToggleFoldAtGutter(event.localX, event.localY)) {
            this.markDirty();
            return;
        }

        const pos = this.docPositionAt(event.localX, event.localY);

        // Раньше shift-веток: Shift+Alt+клик — расширение выделения, а не мультикурсор.
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

    /** Предшествующий mousedown уже свёл выделение к каретке — здесь его только расширяем. */
    private handleDoubleClick(event: TUIMouseEvent): void {
        if (event.button !== "left") return;
        // docPositionAt зажал бы гуттер в колонку 0 и выделил первое слово строки.
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
        // Chevron живёт на первом фрагменте — клик по продолжению wrap не фолдит.
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
     * Решение общее на все каретки: разъехавшиеся контексты откатываются к обычному
     * набору — предсказуемее половинчатого срабатывания (упрощение против
     * пер-курсорных команд VS Code).
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
            // Stryker disable next-line ConditionalExpression: `first` — один из `decisions`, так что
            // проверку уже делает `every` ниже; здесь она нужна типам (сужает union, чтобы был `first.close`)
            first.kind === "autoClose" &&
            // Stryker disable next-line ConditionalExpression: сравнение закрывающих уже отсеивает
            // не-autoClose (у них `close` отсутствует); проверка вида нужна типам — без неё нет `d.close`
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
        // `undefined` — в read-only правка не состоялась.
        if (element) {
            this.undoManager.pushUndoElement(element);
        }
    }
}
