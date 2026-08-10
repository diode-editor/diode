import type { IDisposable } from "../../../../tuidom/common/disposable.ts";
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
import { ELLIPSIS, rowLine, rowSide } from "../common/diff/diffViewText.ts";
import type { IDiffViewRow } from "../common/diff/diffViewModel.ts";
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

// Отступы гуттера повторяют редактор (`editorElement.ts`: GUTTER_LEFT_PADDING и
// FOLD_GAP_LEFT/RIGHT вокруг колонки чевронов), чтобы дифф читался как та же
// компонента, а не как отдельный виджет: номера не липнут к левому краю, а текст
// не липнет к маркеру.
const GUTTER_LEFT_PADDING = 2;
const GUTTER_RIGHT_PADDING = 2;

/** Пустой документ до первого `setRows` — чтобы `viewState` никогда не был null. */
function createEmptyViewState(): EditorViewState {
    const viewState = new EditorViewState(new TextDocument("", "plaintext"));
    viewState.readOnly = true;
    return viewState;
}

/**
 * Отрисовка inline-диффа: список {@link IDiffViewRow} с гуттером на два номера
 * строки (оригинал / изменённый) и маркером `-`/`+`.
 *
 * Это **текстовая поверхность, но не редактор**: каретка ходит, текст
 * выделяется и копируется, а правка запрещена — ровно как дифф в VS Code.
 * Достигается тем, что элемент работает поверх настоящего
 * {@link EditorViewState} с `readOnly = true`, только документ у него
 * синтетический: строка i — это текст i-й строки вью (у свёрнутого куска —
 * его плейсхолдер). Поэтому движение каретки, выделение, навигация по словам,
 * страницы и горизонтальная прокрутка — не вторая реализация, а тот же код,
 * что у редактора; своими остаются лишь гуттер на два номера, фон
 * added/deleted и подсветка по сторонам.
 */
export class DiffViewElement extends TUIElement implements IScrollable {
    private rowsValue: readonly IDiffViewRow[] = [];
    private source: IDiffRowSource | null = null;
    private viewStateValue: EditorViewState = createEmptyViewState();
    private viewStateListeners: IDisposable[] = [];
    private lineWidthCache: LineWidthCache | null = null;
    private numberWidth = 1;
    private dragAnchor: { line: number; character: number } | null = null;

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

    /**
     * Новый снимок диффа. `viewState` строит панель — она же владеет текстами
     * сторон, из которых собран синтетический документ ({@link buildDiffViewText}).
     */
    public setRows(rows: readonly IDiffViewRow[], source: IDiffRowSource, viewState: EditorViewState): void {
        for (const listener of this.viewStateListeners) listener.dispose();
        this.rowsValue = rows;
        this.source = source;
        this.viewStateValue = viewState;
        this.numberWidth = computeNumberWidth(rows);
        // Кэш ширин привязывается к документу навсегда, а документ у диффа
        // меняется на каждый снимок — иначе горизонтальный скроллбар залипнет
        // от прошлого.
        this.lineWidthCache = null;
        this.viewStateListeners = [
            viewState.onDidChangeCursorPosition(() => {
                this.markDirty();
            }),
            viewState.onDidChangeView(() => {
                this.markDirty();
            }),
        ];
        this.markDirty();
    }

    public get rows(): readonly IDiffViewRow[] {
        return this.rowsValue;
    }

    /** Состояние текстовой поверхности: каретка, выделение, скролл. */
    public get viewState(): EditorViewState {
        return this.viewStateValue;
    }

    /** Правка запрещена по устройству панели; парный ключ — `editorReadonly`. */
    public get readOnly(): boolean {
        return this.viewStateValue.readOnly;
    }

    /** Ширину таба задаёт снимок (`createDiffViewState`) — здесь только чтение. */
    public get tabSize(): number {
        return this.viewStateValue.tabSize;
    }

    /** Ширина гуттера: `отступ + номер + зазор + номер + зазор + маркер + отступ`. */
    public get gutterWidth(): number {
        const separators = 2;
        const marker = 1;
        return GUTTER_LEFT_PADDING + this.numberWidth * 2 + separators + marker + GUTTER_RIGHT_PADDING;
    }

    public get contentHeight(): number {
        return this.viewStateValue.getViewLineCount();
    }

    public get contentWidth(): number {
        if (this.lineWidthCache === null) {
            this.lineWidthCache = new LineWidthCache(this.viewStateValue.document, this.tabSize);
        }
        this.lineWidthCache.setTabSize(this.tabSize);
        return this.gutterWidth + this.lineWidthCache.getMaxWidth();
    }

    public get scrollTop(): number {
        return this.viewStateValue.scrollTop;
    }

    public get scrollLeft(): number {
        return this.viewStateValue.scrollLeft;
    }

    public scrollBy(lines: number): void {
        const viewState = this.viewStateValue;
        const maxTop = Math.max(0, viewState.getViewLineCount() - this.layoutSize.height);
        viewState.scrollTop = Math.min(Math.max(0, viewState.scrollTop + lines), maxTop);
    }

    /**
     * Текст текущего выделения — то, что уедет в буфер обмена. Отдельно от
     * `EditorViewState.getSelectedText()`, потому что строки-плейсхолдеры
     * («⋯ N unchanged lines») из результата выпадают целиком: это не текст
     * файла, и вставлять его некуда. Номера строк и маркеры `-`/`+` не
     * попадают и подавно — они в гуттере, а не в тексте.
     */
    public getSelectedText(): string {
        const selection = this.viewStateValue.selections[0];
        if (isSelectionCollapsed(selection)) return "";

        const range = selectionToRange(selection);
        const parts: string[] = [];
        for (let line = range.start.line; line <= range.end.line; line++) {
            if (this.rowsValue[line].kind === "collapsed") continue;
            const text = this.viewStateValue.document.getLineContent(line);
            const from = line === range.start.line ? range.start.character : 0;
            const to = line === range.end.line ? range.end.character : text.length;
            parts.push(text.slice(from, to));
        }
        return parts.join("\n");
    }

    /** Позиция в строках вью под локальной точкой; гуттер маппится в колонку 0. */
    public docPositionAt(localX: number, localY: number): { line: number; character: number } {
        return docPositionAt(this.viewStateValue, this.gutterWidth, localX, localY);
    }

    public override inspectState(): Record<string, unknown> {
        const viewState = this.viewStateValue;
        const selections = viewState.selections.map((s) => ({
            anchor: { line: s.anchor.line, character: s.anchor.character },
            active: { line: s.active.line, character: s.active.character },
            collapsed: s.anchor.line === s.active.line && s.anchor.character === s.active.character,
        }));
        return {
            readOnly: viewState.readOnly,
            rowCount: this.rowsValue.length,
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

    public render(context: RenderContext): void {
        const viewState = this.viewStateValue;
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
            const bg = row === undefined ? this.resolvedStyle.bg : this.backgroundOf(row);

            // Фон на всю ширину — иначе цвет строки обрывался бы по концу текста.
            for (let x = 0; x < this.layoutSize.width; x++) {
                context.setCell(x, screenY, { char: " ", bg, width: 1 });
            }
            if (row === undefined) continue;

            this.renderGutter(context, screenY, row, bg);
            this.renderContent(context, screenY, scrollTop + screenY, row, {
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

    private backgroundOf(row: IDiffViewRow): number {
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
    private renderGutter(context: RenderContext, screenY: number, row: IDiffViewRow, bg: number): void {
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

    private renderContent(
        context: RenderContext,
        screenY: number,
        viewLine: number,
        row: IDiffViewRow,
        geo: { gutterW: number; contentCols: number; scrollLeft: number; bg: number },
    ): void {
        const source = this.source;
        /* v8 ignore start -- defensive: строки без источника не выставляются (setRows принимает их вместе) */
        if (source === null) return;
        /* v8 ignore stop */

        const viewState = this.viewStateValue;
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

        const pos = this.docPositionAt(event.localX, event.localY);
        const viewState = this.viewStateValue;
        if (event.shiftKey) {
            const anchor = viewState.selections[0].anchor;
            this.dragAnchor = { line: anchor.line, character: anchor.character };
            viewState.selections = [createSelection(anchor.line, anchor.character, pos.line, pos.character)];
        } else {
            this.dragAnchor = { line: pos.line, character: pos.character };
            viewState.selections = [createCursorSelection(pos.line, pos.character)];
        }
    }

    /** Двойной клик выделяет слово под курсором (поведение VS Code). */
    private handleDoubleClick(event: TUIMouseEvent): void {
        if (event.button !== "left") return;
        // Гуттер — не текст: docPositionAt схлопнул бы позицию в колонку 0 и
        // выделил первое слово строки, по которой не кликали.
        if (event.localX < this.gutterWidth) return;

        const pos = this.docPositionAt(event.localX, event.localY);
        const word = findWordRangeAt(this.viewStateValue.document.getLineContent(pos.line), pos.character);
        if (word === null) return; // пробел или пунктуация — каретку не трогаем

        this.dragAnchor = null;
        this.viewStateValue.selections = [createSelection(pos.line, word.start, pos.line, word.end)];
    }

    private handleMouseMove(event: TUIMouseEvent): void {
        if (this.dragAnchor === null) return;
        const pos = this.docPositionAt(event.localX, event.localY);
        this.viewStateValue.selections = [
            createSelection(this.dragAnchor.line, this.dragAnchor.character, pos.line, pos.character),
        ];
    }
}

/** Ширина колонки номера — по самому большому номеру строки в наборе. */
function computeNumberWidth(rows: readonly IDiffViewRow[]): number {
    let max = 0;
    for (const row of rows) {
        if (row.kind === "unchanged" || row.kind === "deleted") max = Math.max(max, row.originalLine + 1);
        if (row.kind === "unchanged" || row.kind === "added") max = Math.max(max, row.modifiedLine + 1);
    }
    return Math.max(1, String(max).length);
}
