import type { IDisposable } from "../../../../tuidom/common/disposable.ts";
import type { BoxConstraints, Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { Size as SizeClass } from "../../../../tuidom/common/geometryPromitives.ts";
import type { TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { RenderContext, TUIElement } from "../../../../tuidom/dom/tuiElement.ts";
import type { IScrollable } from "../../../../tuidom/ui/scrollbar/iScrollable.ts";
import {
    createCursorSelection,
    createSelection,
    isSelectionCollapsed,
    selectionToRange,
} from "../common/core/iSelection.ts";
import { findWordRangeAt } from "../common/core/wordClassification.ts";
import type { DiffSide } from "../common/diff/diffViewText.ts";
import { collapsedRowLabel, ELLIPSIS, rowLine, rowSide } from "../common/diff/diffViewText.ts";
import type { IDiffViewRow } from "../common/diff/diffViewModel.ts";
import type { ISideBySideRow } from "../common/diff/sideBySideRows.ts";
import { inlineLineOf, sideBySideLineOf, sideLineOf } from "../common/diff/sideBySideRows.ts";
import type { ILineTokens } from "../common/languages/iLineTokens.ts";
import type { ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { LineWidthCache } from "../common/viewModel/lineWidthCache.ts";

import type { ITextViewportGeometry } from "./textViewRendering.ts";
import {
    caretLocalCell,
    docPositionAt,
    paintRangeBackground,
    paintTextLine,
    SELECTION_BG,
} from "./textViewRendering.ts";
import { TokenIndex } from "./tokenIndex.ts";

/**
 * Токены для подсветки — реализует владелец элемента (панель), потому что
 * токен-сторами сторон владеет он. Текст элемент берёт не отсюда, а из
 * синтетического документа (см. {@link DiffViewElement}).
 */
export interface IDiffRowSource {
    /** Токены строки на своей стороне; `undefined` — рисуем без подсветки. */
    getLineTokens(side: DiffSide, line: number): ILineTokens | undefined;
    resolveTokenStyle(scopes: readonly string[]): ResolvedTokenStyle;
}

/** Режим отображения диффа. Side-by-side — дефолт, inline — фолбэк узкого окна. */
export type DiffViewMode = "inline" | "side-by-side";

/**
 * Минимальная ширина (в колонках), при которой дифф рисуется side-by-side.
 * Аналог `diffEditor.renderSideBySideInlineBreakpoint` VS Code. Порог — ширина
 * САМОГО ЭЛЕМЕНТА, не терминала: сайдбар и скроллбар съедают ~20 колонок,
 * поэтому 100 здесь — это терминал от ~120 колонок с открытым сайдбаром (узже
 * него две колонки по ~45 знаков текста перестают вмещать осмысленный код).
 * Реальный запуск это и поймал: порог 120 по элементу оставлял inline даже на
 * 140-колоночном терминале.
 */
export const SIDE_BY_SIDE_MIN_COLS = 100;

/**
 * Снимок диффа целиком: обе проекции строк (inline и спаренная), поверхности
 * всех трёх синтетических документов и подписи сторон. Строит панель — она
 * владеет текстами сторон.
 */
export interface IDiffViewInput {
    readonly rows: readonly IDiffViewRow[];
    readonly sideRows: readonly ISideBySideRow[];
    readonly source: IDiffRowSource;
    readonly inlineViewState: EditorViewState;
    readonly sideViewStates: Record<DiffSide, EditorViewState>;
    /** Подписи над колонками side-by-side (US-14): `HEAD` / имя файла. */
    readonly labels: Record<DiffSide, string>;
}

// Отступы гуттера повторяют редактор (`editorElement.ts`: GUTTER_LEFT_PADDING и
// FOLD_GAP_LEFT/RIGHT вокруг колонки чевронов), чтобы дифф читался как та же
// компонента, а не как отдельный виджет: номера не липнут к левому краю, а текст
// не липнет к маркеру.
const GUTTER_LEFT_PADDING = 2;
const GUTTER_RIGHT_PADDING = 2;

// Пер-сторонний гуттер side-by-side компактнее inline-гуттера: две колонки и
// без того тесные, поэтому по одному пробелу по краям номера вместо двух.
const SIDE_GUTTER_LEFT_PADDING = 1;
const SIDE_GUTTER_RIGHT_PADDING = 1;

/** Вертикальный разделитель колонок side-by-side. */
const COLUMN_SEPARATOR = "│";

/** Заполнитель строки-филлера (US-15): напротив есть строка, здесь — нет. */
const FILLER_CHAR = "░";

/** Пустой документ до первого `setDiff` — чтобы `viewState` никогда не был null. */
function createEmptyViewState(): EditorViewState {
    const viewState = new EditorViewState(new TextDocument("", "plaintext"));
    viewState.readOnly = true;
    return viewState;
}

/** Геометрия одной колонки side-by-side в координатах элемента. */
interface IColumnGeometry {
    /** X начала колонки (гуттера). */
    readonly x: number;
    /** X начала текста — он же `gutterW` для функций `textViewRendering`. */
    readonly textX: number;
    /** Ширина текстовой зоны. */
    readonly contentCols: number;
}

/**
 * Отрисовка диффа в двух режимах: side-by-side (дефолт) и inline (фолбэк
 * узкого окна, порог {@link SIDE_BY_SIDE_MIN_COLS}). Side-by-side — две колонки
 * с пер-сторонними гуттерами и синхронным скроллом; inline — общий список строк
 * с гуттером на два номера. Режим выбирает layout по фактической ширине.
 *
 * Это **текстовая поверхность, но не редактор**: каретка ходит, текст
 * выделяется и копируется, а правка запрещена — ровно как дифф в VS Code.
 * Достигается тем, что элемент работает поверх настоящего
 * {@link EditorViewState} с `readOnly = true`, только документ у него
 * синтетический: в inline строка i — текст i-й строки вью, в side-by-side у
 * каждой стороны свой документ, где строка i — текст этой стороны в i-й
 * спаренной строке (у филлера — пустая, у свёрнутого куска — плейсхолдер).
 * Поэтому движение каретки, выделение, навигация по словам, страницы и
 * горизонтальная прокрутка — не вторая реализация, а тот же код, что у
 * редактора; своими остаются гуттеры, фон added/deleted, филлеры и подсветка
 * по сторонам. Активна ровно одна поверхность ({@link viewState}): в inline —
 * общая, в side-by-side — сторона под кареткой ({@link activeSide}).
 */
export class DiffViewElement extends TUIElement implements IScrollable {
    private rowsValue: readonly IDiffViewRow[] = [];
    private sideRowsValue: readonly ISideBySideRow[] = [];
    private source: IDiffRowSource | null = null;
    private inlineViewState: EditorViewState = createEmptyViewState();
    private sideViewStates: Record<DiffSide, EditorViewState> = {
        original: createEmptyViewState(),
        modified: createEmptyViewState(),
    };
    private labelsValue: Record<DiffSide, string> = { original: "", modified: "" };
    private viewStateListeners: IDisposable[] = [];
    private lineWidthCaches: { inline: LineWidthCache | null; original: LineWidthCache | null; modified: LineWidthCache | null } =
        { inline: null, original: null, modified: null };
    private numberWidth = 1;
    private sideNumberWidths: Record<DiffSide, number> = { original: 1, modified: 1 };
    private dragAnchor: { side: DiffSide | null; line: number; character: number } | null = null;
    private modeValue: DiffViewMode = "inline";
    private activeSideValue: DiffSide = "modified";

    /**
     * Порог side-by-side. Публичное поле, а не константа в замыкании: тесты
     * занижают его, чтобы не рендерить экран в полторы сотни колонок.
     */
    public sideBySideMinCols = SIDE_BY_SIDE_MIN_COLS;

    public constructor() {
        super();
        this.focusable = true;
        this.addEventListener("wheel", (event) => {
            this.handleWheel(event);
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
    }

    /** Новый снимок диффа. Все поверхности строит панель ({@link IDiffViewInput}). */
    public setDiff(input: IDiffViewInput): void {
        for (const listener of this.viewStateListeners) listener.dispose();
        this.rowsValue = input.rows;
        this.sideRowsValue = input.sideRows;
        this.source = input.source;
        this.inlineViewState = input.inlineViewState;
        this.sideViewStates = input.sideViewStates;
        this.labelsValue = input.labels;
        this.numberWidth = computeNumberWidth(input.rows);
        this.sideNumberWidths = {
            original: computeSideNumberWidth(input.sideRows, "original"),
            modified: computeSideNumberWidth(input.sideRows, "modified"),
        };
        // Кэш ширин привязывается к документу навсегда, а документы у диффа
        // меняются на каждый снимок — иначе горизонтальный скроллбар залипнет
        // от прошлого.
        this.lineWidthCaches = { inline: null, original: null, modified: null };
        const markDirty = (): void => {
            this.markDirty();
        };
        this.viewStateListeners = [
            input.inlineViewState.onDidChangeCursorPosition(markDirty),
            input.inlineViewState.onDidChangeView(markDirty),
            input.sideViewStates.original.onDidChangeCursorPosition(markDirty),
            input.sideViewStates.modified.onDidChangeCursorPosition(markDirty),
            // Синхронный скролл сторон (US-16/17): любое смещение зеркалится в
            // соседа. Рекурсия глохнет сама: сеттеры scrollTop/scrollLeft —
            // no-op при равенстве, поэтому обратное эхо не стреляет.
            input.sideViewStates.original.onDidChangeView(() => {
                this.mirrorScroll("original");
                this.markDirty();
            }),
            input.sideViewStates.modified.onDidChangeView(() => {
                this.mirrorScroll("modified");
                this.markDirty();
            }),
        ];
        this.markDirty();
    }

    private mirrorScroll(from: DiffSide): void {
        const source = this.sideViewStates[from];
        const target = this.sideViewStates[from === "original" ? "modified" : "original"];
        target.scrollTop = source.scrollTop;
        target.scrollLeft = source.scrollLeft;
    }

    public get rows(): readonly IDiffViewRow[] {
        return this.rowsValue;
    }

    public get sideRows(): readonly ISideBySideRow[] {
        return this.sideRowsValue;
    }

    /** Текущий режим отображения; выбирает layout по ширине. */
    public get mode(): DiffViewMode {
        return this.modeValue;
    }

    /** Сторона, в которой живут каретка и выделение side-by-side. */
    public get activeSide(): DiffSide {
        return this.activeSideValue;
    }

    /**
     * Состояние активной текстовой поверхности: каретка, выделение, скролл.
     * В inline — общая поверхность, в side-by-side — активная сторона.
     */
    public get viewState(): EditorViewState {
        return this.modeValue === "side-by-side" ? this.sideViewStates[this.activeSideValue] : this.inlineViewState;
    }

    /** Правка запрещена по устройству панели; парный ключ — `editorReadonly`. */
    public get readOnly(): boolean {
        return this.viewState.readOnly;
    }

    /** Ширина inline-гуттера: `отступ + номер + зазор + номер + зазор + маркер + отступ`. */
    public get gutterWidth(): number {
        const separators = 2;
        const marker = 1;
        return GUTTER_LEFT_PADDING + this.numberWidth * 2 + separators + marker + GUTTER_RIGHT_PADDING;
    }

    /** Ширина пер-стороннего гуттера side-by-side: `отступ + номер + зазор + маркер + отступ`. */
    public sideGutterWidth(side: DiffSide): number {
        const gap = 1;
        const marker = 1;
        return SIDE_GUTTER_LEFT_PADDING + this.sideNumberWidths[side] + gap + marker + SIDE_GUTTER_RIGHT_PADDING;
    }

    /** Строк шапки над текстом: заголовок сторон есть только у side-by-side. */
    public get headerRows(): number {
        return this.modeValue === "side-by-side" ? 1 : 0;
    }

    /** Геометрия колонки стороны при текущей ширине (валидна в side-by-side). */
    public columnGeometry(side: DiffSide): IColumnGeometry {
        const width = this.layoutSize.width;
        const leftWidth = Math.floor((width - 1) / 2);
        if (side === "original") {
            const textX = Math.min(this.sideGutterWidth("original"), leftWidth);
            return { x: 0, textX, contentCols: Math.max(0, leftWidth - textX) };
        }
        const x = leftWidth + 1;
        const textX = Math.min(x + this.sideGutterWidth("modified"), width);
        return { x, textX, contentCols: Math.max(0, width - textX) };
    }

    public get contentHeight(): number {
        return this.viewState.getViewLineCount() + this.headerRows;
    }

    public get contentWidth(): number {
        if (this.modeValue === "side-by-side") {
            // Общая полоса на два синхронных текста: непрокручиваемая часть —
            // всё, кроме самой узкой текстовой зоны, прокручиваемая — самая
            // длинная строка обеих сторон. Тогда предел полосы совпадает с
            // фактическим пределом scrollLeft.
            const maxText = Math.max(this.maxLineWidth("original"), this.maxLineWidth("modified"));
            const minContentCols = Math.min(
                this.columnGeometry("original").contentCols,
                this.columnGeometry("modified").contentCols,
            );
            return this.layoutSize.width - minContentCols + maxText;
        }
        return this.gutterWidth + this.maxLineWidth("inline");
    }

    private maxLineWidth(surface: "inline" | DiffSide): number {
        const viewState = surface === "inline" ? this.inlineViewState : this.sideViewStates[surface];
        let cache = this.lineWidthCaches[surface];
        if (cache === null) {
            cache = new LineWidthCache(viewState.document, viewState.tabSize);
            this.lineWidthCaches[surface] = cache;
        }
        cache.setTabSize(viewState.tabSize);
        return cache.getMaxWidth();
    }

    public get scrollTop(): number {
        return this.viewState.scrollTop;
    }

    public get scrollLeft(): number {
        return this.viewState.scrollLeft;
    }

    public scrollBy(lines: number): void {
        const viewState = this.viewState;
        const viewportLines = Math.max(1, this.layoutSize.height - this.headerRows);
        const maxTop = Math.max(0, viewState.getViewLineCount() - viewportLines);
        viewState.scrollTop = Math.min(Math.max(0, viewState.scrollTop + lines), maxTop);
    }

    /**
     * Текст текущего выделения — то, что уедет в буфер обмена. Отдельно от
     * `EditorViewState.getSelectedText()`, потому что строки-плейсхолдеры
     * («⋯ N unchanged lines») и филлеры side-by-side из результата выпадают
     * целиком: это не текст файла, и вставлять его некуда. Номера строк и
     * маркеры `-`/`+` не попадают и подавно — они в гуттере, а не в тексте.
     */
    public getSelectedText(): string {
        const viewState = this.viewState;
        const selection = viewState.selections[0];
        if (isSelectionCollapsed(selection)) return "";

        const sideBySide = this.modeValue === "side-by-side";
        const range = selectionToRange(selection);
        const parts: string[] = [];
        for (let line = range.start.line; line <= range.end.line; line++) {
            if (sideBySide) {
                const row = this.sideRowsValue[line];
                if (row.kind === "collapsed" || sideLineOf(row, this.activeSideValue) === null) continue;
            } else if (this.rowsValue[line].kind === "collapsed") {
                continue;
            }
            const text = viewState.document.getLineContent(line);
            const from = line === range.start.line ? range.start.character : 0;
            const to = line === range.end.line ? range.end.character : text.length;
            parts.push(text.slice(from, to));
        }
        return parts.join("\n");
    }

    /**
     * Позиция в строках вью под локальной точкой. В inline гуттер маппится в
     * колонку 0; в side-by-side точка сперва попадает в колонку
     * ({@link hitSide}), и позиция считается в её поверхности.
     */
    public docPositionAt(localX: number, localY: number): { line: number; character: number } {
        if (this.modeValue === "side-by-side") {
            const side = this.hitSide(localX);
            return this.sidePositionAt(side, localX, localY);
        }
        return docPositionAt(this.inlineViewState, this.gutterWidth, localX, localY);
    }

    /** Колонка под локальной X-координатой; разделитель отходит левой. */
    public hitSide(localX: number): DiffSide {
        return localX <= Math.floor((this.layoutSize.width - 1) / 2) ? "original" : "modified";
    }

    private sidePositionAt(side: DiffSide, localX: number, localY: number): { line: number; character: number } {
        const geometry = this.columnGeometry(side);
        // Гуттер и всё левее начала текста колонки — колонка 0 её строки; для
        // правой стороны это требует вычесть X колонки, `docPositionAt` про
        // колонки не знает.
        return docPositionAt(
            this.sideViewStates[side],
            geometry.textX,
            Math.max(localX, geometry.x),
            Math.max(0, localY - this.headerRows),
        );
    }

    public override inspectState(): Record<string, unknown> {
        const viewState = this.viewState;
        const selections = viewState.selections.map((s) => ({
            anchor: { line: s.anchor.line, character: s.anchor.character },
            active: { line: s.active.line, character: s.active.character },
            collapsed: s.anchor.line === s.active.line && s.anchor.character === s.active.character,
        }));
        return {
            readOnly: viewState.readOnly,
            mode: this.modeValue,
            activeSide: this.activeSideValue,
            rowCount: this.rowsValue.length,
            sideRowCount: this.sideRowsValue.length,
            scrollTop: viewState.scrollTop,
            scrollLeft: viewState.scrollLeft,
            selections,
            hasSelection: selections.some((s) => !s.collapsed),
        };
    }

    public override getMinIntrinsicWidth(): number {
        return this.gutterWidth;
    }

    public override getMaxIntrinsicWidth(): number {
        return Number.MAX_SAFE_INTEGER;
    }

    public override getMinIntrinsicHeight(): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(): number {
        return Math.max(1, this.rowsValue.length);
    }

    /**
     * Выбор режима по фактической ширине (US-21): side-by-side при
     * `>= sideBySideMinCols`, иначе inline. При смене режима каретка и скролл
     * переезжают на новую поверхность через координату «(сторона, строка
     * файла)» (US-23) — прямого соответствия строк вью между режимами нет.
     */
    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const mode: DiffViewMode = size.width >= this.sideBySideMinCols ? "side-by-side" : "inline";
        if (mode !== this.modeValue) {
            this.transferState(this.modeValue, mode);
            this.modeValue = mode;
            this.markDirty();
        }
        return size;
    }

    /** Перенос каретки и скролла между поверхностями режимов. */
    private transferState(from: DiffViewMode, to: DiffViewMode): void {
        if (this.rowsValue.length === 0 || this.sideRowsValue.length === 0) return;

        const source = from === "side-by-side" ? this.sideViewStates[this.activeSideValue] : this.inlineViewState;
        const caret = source.selections[0].active;
        const anchor = this.anchorOf(from, caret.line);

        if (to === "side-by-side") {
            const side = anchor?.side ?? this.activeSideValue;
            this.activeSideValue = side;
            const target = this.sideViewStates[side];
            const line = anchor === null
                ? Math.min(caret.line, this.sideRowsValue.length - 1)
                : sideBySideLineOf(this.sideRowsValue, anchor.side, anchor.fileLine);
            this.moveCaret(target, line, caret.character);
            const topLine = Math.min(source.scrollTop, this.rowsValue.length - 1);
            const topAnchor = this.anchorOf(from, topLine);
            target.scrollTop = topAnchor === null
                ? Math.min(topLine, this.sideRowsValue.length - 1)
                : sideBySideLineOf(this.sideRowsValue, topAnchor.side, topAnchor.fileLine);
            target.scrollLeft = source.scrollLeft;
            this.mirrorScroll(side);
        } else {
            const target = this.inlineViewState;
            const line = anchor === null
                ? Math.min(caret.line, this.rowsValue.length - 1)
                : inlineLineOf(this.rowsValue, anchor.side, anchor.fileLine);
            this.moveCaret(target, line, caret.character);
            const topLine = Math.min(source.scrollTop, this.sideRowsValue.length - 1);
            const topAnchor = this.anchorOf(from, topLine);
            target.scrollTop = topAnchor === null
                ? Math.min(topLine, this.rowsValue.length - 1)
                : inlineLineOf(this.rowsValue, topAnchor.side, topAnchor.fileLine);
            target.scrollLeft = source.scrollLeft;
        }
    }

    /**
     * Координата «(сторона, строка файла)» строки вью режима `mode`; `null` у
     * плашки — у неё стороны нет, перенос падает на ту же визуальную строку.
     * У филлера side-by-side берётся противоположная сторона той же спаренной
     * строки — каретка останется на той же визуальной высоте. `viewLine`
     * всегда в пределах вью: каретка живёт в документе той же длины, а верхняя
     * строка скролла заклампена вызывающим.
     */
    private anchorOf(mode: DiffViewMode, viewLine: number): { side: DiffSide; fileLine: number } | null {
        if (mode === "side-by-side") {
            const row = this.sideRowsValue[viewLine];
            if (row.kind === "collapsed") return null;
            const active = sideLineOf(row, this.activeSideValue);
            if (active !== null) return { side: this.activeSideValue, fileLine: active };
            const other: DiffSide = this.activeSideValue === "original" ? "modified" : "original";
            const line = sideLineOf(row, other);
            /* v8 ignore start -- недостижимо: у changed не бывает двух филлеров (инвариант buildSideBySideRows) */
            if (line === null) return null;
            /* v8 ignore stop */
            return { side: other, fileLine: line };
        }
        const row = this.rowsValue[viewLine];
        if (row.kind === "collapsed") return null;
        return row.kind === "deleted"
            ? { side: "original", fileLine: row.originalLine }
            : { side: "modified", fileLine: row.modifiedLine };
    }

    private moveCaret(target: EditorViewState, line: number, character: number): void {
        const clamped = Math.min(Math.max(0, line), Math.max(0, target.getViewLineCount() - 1));
        const maxCharacter = target.document.getLineContent(clamped).length;
        target.selections = [createCursorSelection(clamped, Math.min(character, maxCharacter))];
    }

    public render(context: RenderContext): void {
        if (this.modeValue === "side-by-side") this.renderSideBySide(context);
        else this.renderInline(context);
    }

    private renderInline(context: RenderContext): void {
        const viewState = this.inlineViewState;
        const gutterW = this.gutterWidth;
        const contentCols = Math.max(0, this.layoutSize.width - gutterW);
        const height = this.layoutSize.height;
        // Без этого cursorPageUp/Down и revealPosition считают по дефолтным 80×24.
        viewState.viewportWidth = contentCols;
        viewState.viewportHeight = height;

        const scrollTop = viewState.scrollTop;
        const scrollLeft = viewState.scrollLeft;
        const viewLineCount = viewState.getViewLineCount();

        for (let screenY = 0; screenY < height; screenY++) {
            const row = this.rowsValue.at(scrollTop + screenY);
            const bg = row === undefined ? this.resolvedStyle.bg : this.inlineBackgroundOf(row);

            // Фон на всю ширину — иначе цвет строки обрывался бы по концу текста.
            for (let x = 0; x < this.layoutSize.width; x++) {
                context.setCell(x, screenY, { char: " ", bg, width: 1 });
            }
            if (row === undefined) continue;

            this.renderInlineGutter(context, screenY, row, bg);
            this.renderInlineContent(context, screenY, scrollTop + screenY, row, {
                gutterW,
                contentCols,
                scrollLeft,
                bg,
            });
        }

        // Выделение — поверх фона added/deleted и поверх токенов: красится только
        // `bg`, поэтому глиф и его цвет остаются на месте.
        const geometry: ITextViewportGeometry = {
            scrollTop,
            scrollLeft,
            visibleLines: height,
            viewLineCount,
            contentCols,
            gutterW,
        };
        for (const selection of viewState.selections) {
            if (isSelectionCollapsed(selection)) continue;
            paintRangeBackground(context, viewState, selectionToRange(selection), SELECTION_BG, geometry);
        }

        const caret = caretLocalCell(viewState, gutterW, this.layoutSize);
        if (this.isFocused && caret !== null) {
            context.setCursorPosition(caret.x, caret.y);
        }
    }

    private renderSideBySide(context: RenderContext): void {
        const width = this.layoutSize.width;
        const height = this.layoutSize.height;
        const headerRows = this.headerRows;
        const viewportLines = Math.max(0, height - headerRows);
        const columns: Record<DiffSide, IColumnGeometry> = {
            original: this.columnGeometry("original"),
            modified: this.columnGeometry("modified"),
        };
        for (const side of ["original", "modified"] as const) {
            const viewState = this.sideViewStates[side];
            viewState.viewportWidth = columns[side].contentCols;
            viewState.viewportHeight = viewportLines;
        }

        const active = this.sideViewStates[this.activeSideValue];
        const scrollTop = active.scrollTop;
        const scrollLeft = active.scrollLeft;
        const separatorX = columns.modified.x - 1;
        const numberFg = this.styleVar("editorLineNumber.foreground");

        this.renderHeader(context, columns, numberFg);

        for (let screenY = headerRows; screenY < height; screenY++) {
            const viewLine = scrollTop + screenY - headerRows;
            const row = this.sideRowsValue.at(viewLine);

            if (row === undefined || row.kind === "collapsed") {
                const bg = this.resolvedStyle.bg;
                for (let x = 0; x < width; x++) {
                    context.setCell(x, screenY, { char: " ", bg, width: 1 });
                }
                if (row === undefined) {
                    context.drawText(separatorX, screenY, COLUMN_SEPARATOR, { fg: numberFg, bg });
                    continue;
                }
                // Плашка свёрнутого куска — одна на обе колонки (US-19):
                // разделитель на ней не рисуется, ⋯ стоит в номерах обеих сторон.
                this.renderCollapsedRow(context, screenY, row, columns, numberFg, bg);
                continue;
            }

            for (const side of ["original", "modified"] as const) {
                this.renderSideCell(context, screenY, viewLine, row, side, columns[side], scrollLeft, numberFg);
            }
            context.drawText(separatorX, screenY, COLUMN_SEPARATOR, { fg: numberFg, bg: this.resolvedStyle.bg });
        }

        // Выделение — только у активной стороны: одна каретка — одно выделение,
        // «перетекания» во вторую колонку нет by design (US-26).
        const geometry: ITextViewportGeometry = {
            scrollTop,
            scrollLeft,
            visibleLines: viewportLines,
            viewLineCount: active.getViewLineCount(),
            contentCols: columns[this.activeSideValue].contentCols,
            gutterW: columns[this.activeSideValue].textX,
            originY: headerRows,
        };
        for (const selection of active.selections) {
            if (isSelectionCollapsed(selection)) continue;
            paintRangeBackground(context, active, selectionToRange(selection), SELECTION_BG, geometry);
        }

        // Правая граница каретки — конец текстовой зоны её колонки, а не края
        // элемента: caretLocalCell про колонки не знает.
        const activeColumn = columns[this.activeSideValue];
        const caret = caretLocalCell(active, activeColumn.textX, new SizeClass(width, viewportLines));
        if (this.isFocused && caret !== null && caret.x < activeColumn.textX + activeColumn.contentCols) {
            context.setCursorPosition(caret.x, caret.y + headerRows);
        }
    }

    /** Заголовок сторон (US-14): подписи над колонками, обрезанные по ширине. */
    private renderHeader(context: RenderContext, columns: Record<DiffSide, IColumnGeometry>, numberFg: number): void {
        const bg = this.resolvedStyle.bg;
        for (let x = 0; x < this.layoutSize.width; x++) {
            context.setCell(x, 0, { char: " ", bg, width: 1 });
        }
        context.drawText(columns.modified.x - 1, 0, COLUMN_SEPARATOR, { fg: numberFg, bg });
        for (const side of ["original", "modified"] as const) {
            const column = columns[side];
            const label = this.labelsValue[side].slice(0, Math.max(0, column.contentCols));
            context.drawText(column.textX, 0, label, { fg: numberFg, bg });
        }
    }

    private renderCollapsedRow(
        context: RenderContext,
        screenY: number,
        row: Extract<ISideBySideRow, { kind: "collapsed" }>,
        columns: Record<DiffSide, IColumnGeometry>,
        numberFg: number,
        bg: number,
    ): void {
        for (const side of ["original", "modified"] as const) {
            const column = columns[side];
            context.drawText(
                column.x + SIDE_GUTTER_LEFT_PADDING,
                screenY,
                ELLIPSIS.padStart(this.sideNumberWidths[side]),
                { fg: numberFg, bg },
            );
        }
        const label = collapsedRowLabel(row.hiddenLineCount);
        const room = Math.max(0, this.layoutSize.width - columns.original.textX);
        context.drawText(columns.original.textX, screenY, label.slice(0, room), {
            fg: this.styleVar("diffEditor.unchangedRegionForeground"),
            bg,
        });
    }

    /** Одна ячейка (гуттер + текст) стороны side-by-side. */
    private renderSideCell(
        context: RenderContext,
        screenY: number,
        viewLine: number,
        row: ISideBySideRow,
        side: DiffSide,
        column: IColumnGeometry,
        scrollLeft: number,
        numberFg: number,
    ): void {
        const source = this.source;
        /* v8 ignore start -- defensive: строки без источника не выставляются (setDiff принимает их вместе) */
        if (source === null) return;
        /* v8 ignore stop */

        const line = sideLineOf(row, side);
        const changed = row.kind === "changed";
        const bg =
            line === null || !changed
                ? this.resolvedStyle.bg
                : side === "original"
                  ? this.styleVar("diffEditor.removedLineBackground")
                  : this.styleVar("diffEditor.insertedLineBackground");
        const columnEnd = side === "original" ? column.textX + column.contentCols : this.layoutSize.width;
        for (let x = column.x; x < columnEnd; x++) {
            context.setCell(x, screenY, { char: " ", bg, width: 1 });
        }

        if (line === null) {
            // Филлер (US-15): напротив есть строка, на этой стороне — нет.
            // Заполнитель ░ отличает его и от пустой строки файла (у той дефолтный
            // фон без глифов), и от added/deleted фона.
            const fillerFg = this.styleVar("diffEditor.diagonalFill");
            for (let x = column.textX; x < column.textX + column.contentCols; x++) {
                context.setCell(x, screenY, { char: FILLER_CHAR, fg: fillerFg, bg, width: 1 });
            }
            return;
        }

        const marker = changed ? (side === "original" ? "-" : "+") : " ";
        context.drawText(
            column.x + SIDE_GUTTER_LEFT_PADDING,
            screenY,
            String(line + 1).padStart(this.sideNumberWidths[side]),
            { fg: numberFg, bg },
        );
        context.drawText(column.x + SIDE_GUTTER_LEFT_PADDING + this.sideNumberWidths[side] + 1, screenY, marker, {
            fg: this.resolvedStyle.fg,
            bg,
        });

        const viewState = this.sideViewStates[side];
        const text = viewState.getViewLine(viewLine);
        const displayLine = viewState.displayLineFor(text);
        const tokens = source.getLineTokens(side, line);
        paintTextLine(context, {
            displayLine,
            tokenIndex: tokens ? new TokenIndex(tokens, text.length) : null,
            resolveStyle: (scopes) => source.resolveTokenStyle(scopes),
            screenY,
            gutterW: column.textX,
            contentCols: column.contentCols,
            scrollLeft,
            fg: this.resolvedStyle.fg,
            bg,
            // Фон строки added/deleted должен побеждать фон токена, иначе
            // полоса изменения рвётся на подсвеченных словах.
            allowTokenBg: false,
        });
    }

    private inlineBackgroundOf(row: IDiffViewRow): number {
        switch (row.kind) {
            case "added":
                return this.styleVar("diffEditor.insertedLineBackground");
            case "deleted":
                return this.styleVar("diffEditor.removedLineBackground");
            default:
                return this.resolvedStyle.bg;
        }
    }

    /** `<номер оригинала> <номер изменённого> <маркер> `. */
    private renderInlineGutter(context: RenderContext, screenY: number, row: IDiffViewRow, bg: number): void {
        const w = this.numberWidth;
        const original = row.kind === "unchanged" || row.kind === "deleted" ? String(row.originalLine + 1) : "";
        const modified = row.kind === "unchanged" || row.kind === "added" ? String(row.modifiedLine + 1) : "";
        const marker = row.kind === "added" ? "+" : row.kind === "deleted" ? "-" : " ";

        const numberFg = this.styleVar("editorLineNumber.foreground");
        const collapsed = row.kind === "collapsed";
        const left = GUTTER_LEFT_PADDING;
        context.drawText(left, screenY, (collapsed ? ELLIPSIS : original).padStart(w), { fg: numberFg, bg });
        context.drawText(left + w + 1, screenY, (collapsed ? ELLIPSIS : modified).padStart(w), { fg: numberFg, bg });
        context.drawText(left + w * 2 + 2, screenY, marker, { fg: this.resolvedStyle.fg, bg });
    }

    private renderInlineContent(
        context: RenderContext,
        screenY: number,
        viewLine: number,
        row: IDiffViewRow,
        geo: { gutterW: number; contentCols: number; scrollLeft: number; bg: number },
    ): void {
        const source = this.source;
        /* v8 ignore start -- defensive: строки без источника не выставляются (setDiff принимает их вместе) */
        if (source === null) return;
        /* v8 ignore stop */

        const viewState = this.inlineViewState;
        const text = viewState.getViewLine(viewLine);
        const displayLine = viewState.displayLineFor(text);

        // Плейсхолдер («⋯ 12 unchanged lines») — такая же строка документа, но
        // стороны у него нет: рисуем своим цветом и без подсветки.
        const side = rowSide(row);
        const tokens = side === null ? undefined : source.getLineTokens(side, rowLine(row));

        paintTextLine(context, {
            displayLine,
            tokenIndex: tokens ? new TokenIndex(tokens, text.length) : null,
            resolveStyle: (scopes) => source.resolveTokenStyle(scopes),
            screenY,
            gutterW: geo.gutterW,
            contentCols: geo.contentCols,
            scrollLeft: geo.scrollLeft,
            fg: side === null ? this.styleVar("diffEditor.unchangedRegionForeground") : this.resolvedStyle.fg,
            bg: geo.bg,
            // Фон строки added/deleted должен побеждать фон токена, иначе
            // полоса изменения рвётся на подсвеченных словах.
            allowTokenBg: false,
        });
    }

    private handleWheel(event: TUIMouseEvent): void {
        if (event.wheelDirection === "up") this.scrollBy(-3);
        else if (event.wheelDirection === "down") this.scrollBy(3);
        else return;
        event.stopPropagation();
    }

    private handleMouseDown(event: TUIMouseEvent): void {
        // Правый клик каретку не трогает: политика у контроллера контекстного меню.
        if (event.button !== "left") return;
        if (event.localY < this.headerRows) return; // заголовок сторон — не текст

        const sideBySide = this.modeValue === "side-by-side";
        const side = sideBySide ? this.hitSide(event.localX) : null;
        if (sideBySide && side !== null && side !== this.activeSideValue) {
            // Переход в другую колонку: выделение прежней стороны схлопывается,
            // чтобы на экране не осталось «чужого» выделения (US-26).
            const previous = this.sideViewStates[this.activeSideValue];
            const caret = previous.selections[0].active;
            previous.selections = [createCursorSelection(caret.line, caret.character)];
            this.activeSideValue = side;
        }

        const pos = this.docPositionAt(event.localX, event.localY);
        const viewState = this.viewState;
        if (event.shiftKey) {
            const anchor = viewState.selections[0].anchor;
            this.dragAnchor = { side, line: anchor.line, character: anchor.character };
            viewState.selections = [createSelection(anchor.line, anchor.character, pos.line, pos.character)];
        } else {
            this.dragAnchor = { side, line: pos.line, character: pos.character };
            viewState.selections = [createCursorSelection(pos.line, pos.character)];
        }
    }

    /** Двойной клик выделяет слово под курсором (поведение VS Code). */
    private handleDoubleClick(event: TUIMouseEvent): void {
        if (event.button !== "left") return;
        if (event.localY < this.headerRows) return;
        // Гуттер — не текст: docPositionAt схлопнул бы позицию в колонку 0 и
        // выделил первое слово строки, по которой не кликали.
        if (this.modeValue === "side-by-side") {
            const side = this.hitSide(event.localX);
            const geometry = this.columnGeometry(side);
            if (event.localX < geometry.textX || event.localX >= geometry.textX + geometry.contentCols) return;
            if (side !== this.activeSideValue) this.activeSideValue = side;
        } else if (event.localX < this.gutterWidth) {
            return;
        }

        const pos = this.docPositionAt(event.localX, event.localY);
        const word = findWordRangeAt(this.viewState.document.getLineContent(pos.line), pos.character);
        if (word === null) return; // пробел или пунктуация — каретку не трогаем

        this.dragAnchor = null;
        this.viewState.selections = [createSelection(pos.line, word.start, pos.line, word.end)];
    }

    private handleMouseMove(event: TUIMouseEvent): void {
        const anchor = this.dragAnchor;
        if (anchor === null) return;
        // Протяжка не покидает колонку якоря (US-26): X клампится в её
        // текстовую зону, поэтому выделение физически не перетекает.
        let pos: { line: number; character: number };
        if (this.modeValue === "side-by-side" && anchor.side !== null) {
            const geometry = this.columnGeometry(anchor.side);
            const clampedX = Math.min(
                Math.max(event.localX, geometry.x),
                Math.max(geometry.x, geometry.textX + geometry.contentCols - 1),
            );
            pos = this.sidePositionAt(anchor.side, clampedX, Math.max(event.localY, this.headerRows));
        } else {
            pos = this.docPositionAt(event.localX, event.localY);
        }
        this.viewState.selections = [createSelection(anchor.line, anchor.character, pos.line, pos.character)];
    }
}

/** Ширина колонки номера inline — по самому большому номеру строки в наборе. */
function computeNumberWidth(rows: readonly IDiffViewRow[]): number {
    let max = 0;
    for (const row of rows) {
        if (row.kind === "unchanged" || row.kind === "deleted") max = Math.max(max, row.originalLine + 1);
        if (row.kind === "unchanged" || row.kind === "added") max = Math.max(max, row.modifiedLine + 1);
    }
    return Math.max(1, String(max).length);
}

/** Ширина колонки номера стороны side-by-side — по её строкам. */
function computeSideNumberWidth(sideRows: readonly ISideBySideRow[], side: DiffSide): number {
    let max = 0;
    for (const row of sideRows) {
        const line = sideLineOf(row, side);
        if (line !== null) max = Math.max(max, line + 1);
    }
    return Math.max(1, String(max).length);
}
