import { packRgb } from "@tuidom/core/common/colorUtils";
import type { DisplayLine } from "@tuidom/core/common/displayLine";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import type { IRange } from "../common/core/iRange.ts";
import type { ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import type { EditorViewState } from "../common/viewModel/editorViewState.ts";

import type { TokenIndex } from "./tokenIndex.ts";
import { packStyleFlags } from "./tokenIndex.ts";

/**
 * Отрисовка и hit-test текстовой поверхности — общее у редактора
 * (`editorElement.ts`) и inline-диффа (`diffViewElement.ts`).
 *
 * Всё здесь — свободные функции над {@link EditorViewState} и геометрией
 * вьюпорта: у двух виджетов свои гуттеры и свои слои фона, а вот «пройти по
 * ячейкам диапазона», «нарисовать строку текста с токенами» и «где каретка на
 * экране» у них совпадают до символа. Наследование вместо этого не годится:
 * `render()` у диффа всё равно свой, зато `instanceof EditorElement` стал бы
 * истинным там, где смысл именно «редактируемый буфер» (см. `iTextViewElement.ts`).
 */

/**
 * Цвет фона выделения. Литерал, а не токен темы: `editor.selectionBackground`
 * объявлен с `defaults: null` (`platform/theme/common/colors/editorColors.ts`),
 * то есть `styleVar` по нему без фоллбэка упадёт. Один цвет на редактор и дифф —
 * выделение обязано выглядеть одинаково.
 */
export const SELECTION_BG = packRgb(38, 79, 120);

/** Геометрия вьюпорта, общая для проходов подсветки диапазонов. */
export interface ITextViewportGeometry {
    scrollTop: number;
    scrollLeft: number;
    visibleLines: number;
    viewLineCount: number;
    contentCols: number;
    gutterW: number;
    /**
     * Экранный сдвиг первой строки вьюпорта вниз — у поверхности со своей
     * шапкой (заголовок сторон side-by-side диффа) текст начинается не с
     * нулевой строки виджета. Отсутствие = 0.
     */
    originY?: number;
}

/**
 * Walks every screen cell covered by `range` within the visible viewport and
 * invokes `visit(screenX, screenY)` (absolute grid coordinates). Shared by the
 * background-highlight and diagnostic-squiggle passes so the viewport/column
 * math lives in one place.
 */
export function forEachRangeCell(
    viewState: EditorViewState,
    range: IRange,
    geo: ITextViewportGeometry,
    visit: (screenX: number, screenY: number) => void,
): void {
    for (let screenY = 0; screenY < geo.visibleLines; screenY++) {
        const viewLine = geo.scrollTop + screenY;
        if (viewLine >= geo.viewLineCount) break;

        const logLine = viewState.visualToLogicalLine(viewLine);
        if (logLine < range.start.line || logLine > range.end.line) continue;

        const lineContent = viewState.getViewLine(viewLine);
        const dl = viewState.displayLineFor(lineContent);
        const startChar = logLine === range.start.line ? range.start.character : 0;
        const endChar = logLine === range.end.line ? range.end.character : lineContent.length + 1;

        const startCol = logLine === range.start.line ? dl.offsetToColumn(startChar) : 0;
        const endCol = logLine === range.end.line ? dl.offsetToColumn(endChar) : dl.displayWidth + 1;

        const screenXStart = Math.max(0, startCol - geo.scrollLeft);
        const screenXEnd = Math.min(geo.contentCols, endCol - geo.scrollLeft);

        for (let screenX = screenXStart; screenX < screenXEnd; screenX++) {
            visit(geo.gutterW + screenX, screenY + (geo.originY ?? 0));
        }
    }
}

/**
 * Paints a solid background colour over the cells covered by `range` within
 * the visible viewport. Only `bg` is set, so the glyph and fg underneath are
 * preserved. Used by both the selection and search-match highlight passes.
 */
export function paintRangeBackground(
    context: RenderContext,
    viewState: EditorViewState,
    range: IRange,
    bg: number,
    geo: ITextViewportGeometry,
): void {
    forEachRangeCell(viewState, range, geo, (screenX, screenY) => {
        context.setCell(screenX, screenY, { bg });
    });
}

export interface IPaintTextLineParams {
    /** Дисплейные слоты строки — считает вызывающий (у него свой tabSize). */
    displayLine: DisplayLine;
    /** Токены строки; `null` — рисуем без подсветки. */
    tokenIndex: TokenIndex | null;
    resolveStyle: (scopes: readonly string[]) => ResolvedTokenStyle;
    screenY: number;
    gutterW: number;
    contentCols: number;
    scrollLeft: number;
    /** Цвета по умолчанию — там, где токен ничего не сказал. */
    fg: number;
    bg: number;
    /**
     * Пускать ли `bg` токена. У редактора — да; у диффа — нет: фон строки
     * added/deleted должен побеждать фон токена, иначе полоса изменения рвётся.
     */
    allowTokenBg: boolean;
}

/**
 * Рисует одну строку текста в контентной области: поцельный обход по
 * ДИСПЛЕЙНЫМ колонкам, поэтому корректно отрабатывают широкие символы, табы и
 * горизонтальная прокрутка.
 */
export function paintTextLine(context: RenderContext, params: IPaintTextLineParams): void {
    const { displayLine, tokenIndex, resolveStyle, screenY, gutterW, contentCols, scrollLeft } = params;

    let screenX = 0;
    while (screenX < contentCols) {
        const displayCol = scrollLeft + screenX;
        const char = displayLine.charAtColumn(displayCol);
        if (char === "") {
            // Continuation column of a wide char — skip, already handled by Grid
            screenX++;
            continue;
        }
        const slot = displayLine.graphemeAtColumn(displayCol);
        const width = slot ? slot.displayWidth : 1;

        // Resolve style for this offset.
        let fg = params.fg;
        let bg = params.bg;
        let style: number = StyleFlags.None;
        if (tokenIndex && slot) {
            const token = tokenIndex.tokenAt(slot.offset);
            if (token) {
                const resolved = resolveStyle(token.scopes);
                if (resolved.fg !== undefined) fg = resolved.fg;
                if (params.allowTokenBg && resolved.bg !== undefined) bg = resolved.bg;
                style = packStyleFlags(resolved);
            }
        }

        if (slot?.grapheme === "\t") {
            // Tab: render each column as an individual space so Grid/TerminalRenderer
            // tracks the cursor correctly (they only support width=1 and width=2).
            for (let i = 0; i < width && screenX + i < contentCols; i++) {
                context.setCell(gutterW + screenX + i, screenY, { char: " ", fg, bg, style, width: 1 });
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
}

/**
 * Локальные (внутри виджета) координаты ячейки каретки первичного курсора, или
 * `null`, если каретка вне видимой области. Одна математика на два потребителя:
 * аппаратный курсор в `render()` и якорь completion-попапа.
 */
export function caretLocalCell(viewState: EditorViewState, gutterW: number, size: Size): Point | null {
    const primary = viewState.selections[0];
    const cursorVisualLine = viewState.logicalToVisualLine(primary.active.line);
    const cursorLineContent = viewState.getViewLine(cursorVisualLine);
    const cursorDl = viewState.displayLineFor(cursorLineContent);
    const localX = cursorDl.offsetToColumn(primary.active.character) - viewState.scrollLeft + gutterW;
    const localY = cursorVisualLine - viewState.scrollTop;

    if (localX < gutterW || localX >= size.width || localY < 0 || localY >= size.height) {
        return null;
    }
    return new Point(localX, localY);
}

/**
 * Документная позиция под локальной точкой (клики, контекстное меню). Клик по
 * гуттеру маппится в колонку 0 — как клик по номеру строки в VS Code.
 */
export function docPositionAt(
    viewState: EditorViewState,
    gutterW: number,
    localX: number,
    localY: number,
): { line: number; character: number } {
    const viewLineCount = viewState.getViewLineCount();
    /* v8 ignore start -- unreachable: a TextDocument always has at least one line and a fold header is never hidden, so getViewLineCount() is never 0 */
    if (viewLineCount === 0) return { line: 0, character: 0 };
    /* v8 ignore stop */

    const viewLine = Math.min(viewState.scrollTop + localY, viewLineCount - 1);
    // Клик по строке-зоне (виртуальной) маппится в ближайшую документную — как
    // клик по view zone в VS Code отдаёт соседнюю позицию, а не падает.
    const logLine = viewState.docLineForViewLine(viewLine);
    const displayCol = localX < gutterW ? 0 : localX - gutterW + viewState.scrollLeft;
    const lineContent = viewState.document.getLineContent(logLine);
    const dl = viewState.displayLineFor(lineContent);
    const charOffset = dl.columnToOffset(displayCol);
    return { line: logLine, character: charOffset };
}
