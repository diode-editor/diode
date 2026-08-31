import { packRgb } from "@tuidom/core/common/colorUtils";
import type { DisplayLine } from "@tuidom/core/common/displayLine";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import type { IRange } from "../common/core/iRange.ts";
import type { ISelection } from "../common/core/iSelection.ts";
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
        // Диапазон пересекается с фрагментом ряда: у целой строки фрагмент —
        // `[0, length)`, и математика вырождается в прежнюю. Виртуальную ячейку
        // перевода строки (+1 за концом) несёт только последний фрагмент.
        const frag = viewState.viewLineRange(viewLine);
        const isLastFragment = frag.end === lineContent.length;
        const rangeStartChar = logLine === range.start.line ? range.start.character : 0;
        const rangeEndChar = logLine === range.end.line ? range.end.character : lineContent.length + 1;
        const startChar = Math.max(rangeStartChar, frag.start);
        const endChar = Math.min(rangeEndChar, isLastFragment ? lineContent.length + 1 : frag.end);

        const fragStartCol = viewState.viewLineStartColumn(viewLine);
        const startCol = dl.offsetToColumn(startChar) - fragStartCol;
        const endCol = (endChar > lineContent.length ? dl.displayWidth + 1 : dl.offsetToColumn(endChar)) - fragStartCol;

        const screenXStart = Math.max(0, startCol - geo.scrollLeft);
        const screenXEnd = Math.min(geo.contentCols, endCol - geo.scrollLeft);

        for (let screenX = screenXStart; screenX < screenXEnd; screenX++) {
            visit(geo.gutterW + screenX, screenY);
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
    /**
     * Дисплейная колонка начала фрагмента при word wrap — сдвигает «колоночное
     * окно» строки, как scrollLeft, но по-строчно. 0 — ряд несёт строку с начала.
     */
    startColumn: number;
    /**
     * Эксклюзивная колонка конца фрагмента: дальше при word wrap лежит текст
     * СЛЕДУЮЩЕГО фрагмента — вместо него до края рисуются пробелы. У
     * последнего/единственного фрагмента это ширина всей строки: заливка
     * хвоста фоном совпадает с прежней отрисовкой out-of-range колонок.
     */
    endColumnExclusive: number;
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
    const { displayLine, tokenIndex, resolveStyle, screenY, gutterW, contentCols, scrollLeft, startColumn } = params;

    let screenX = 0;
    while (screenX < contentCols) {
        const displayCol = scrollLeft + startColumn + screenX;
        if (displayCol >= params.endColumnExclusive) {
            // Конец фрагмента: дальше в строке текст следующего ряда — до края
            // области идёт фон (у последнего фрагмента — как прежняя отрисовка
            // колонок за концом строки).
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
            // Continuation column of a wide char — skip, already handled by Grid
            screenX++;
            continue;
        }
        const slot = displayLine.graphemeAtColumn(displayCol);
        /* v8 ignore start -- defensive: колонки за концом строки (>= endColumnExclusive <= displayWidth) ушли в заливку выше, в отрисовываемом диапазоне слот есть всегда */
        // Stryker disable next-line ConditionalExpression,EqualityOperator,BlockStatement: недостижимый защитный гард, см. v8 ignore
        if (slot === undefined) {
            screenX++;
            continue;
        }
        /* v8 ignore stop */
        const width = slot.displayWidth;

        // Resolve style for this offset.
        let fg = params.fg;
        let bg = params.bg;
        let style: number = StyleFlags.None;
        if (tokenIndex) {
            const token = tokenIndex.tokenAt(slot.offset);
            if (token) {
                const resolved = resolveStyle(token.scopes);
                if (resolved.fg !== undefined) fg = resolved.fg;
                if (params.allowTokenBg && resolved.bg !== undefined) bg = resolved.bg;
                style = packStyleFlags(resolved);
            }
        }

        if (slot.grapheme === "\t") {
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
    const cursorVisualLine = viewState.viewLineForPosition(primary.active.line, primary.active.character);
    const cursorLineContent = viewState.getViewLine(cursorVisualLine);
    const cursorDl = viewState.displayLineFor(cursorLineContent);
    const localX =
        cursorDl.offsetToColumn(primary.active.character) -
        viewState.viewLineStartColumn(cursorVisualLine) -
        viewState.scrollLeft +
        gutterW;
    const localY = cursorVisualLine - viewState.scrollTop;

    if (localX < gutterW || localX >= size.width || localY < 0 || localY >= size.height) {
        return null;
    }
    return new Point(localX, localY);
}

/** Цвета блочной каретки, нарисованной ячейкой. */
export interface ICaretColors {
    /** Цвет символа ПОД кареткой (`editorCursor.background`). */
    readonly fg: number;
    /** Цвет самой каретки (`editorCursor.foreground`). */
    readonly bg: number;
}

/**
 * Рисует каретки ячейками — инверсным блоком поверх уже отрисованного текста.
 * Аппаратный курсор терминала физически один, поэтому мультикурсор показать иначе нечем.
 *
 * Патч частичный (`fg`/`bg`/`style` без `char`/`width`): глиф и ширина ячейки сохраняются,
 * а у широкого символа `Grid.updateCell` сам прокрашивает ячейку-продолжение. `style`
 * сбрасывается явно — блочная каретка не должна тащить bold/undercurl символа под ней
 * (заодно гасит squiggle диагностики).
 *
 * Прямой проход по кареткам: {@link EditorViewState.viewLineForPosition} — O(1)
 * по строке (плюс шаг по её фрагментам), поэтому даже «выделить все вхождения»
 * на большом файле остаётся O(кареток); кэш `DisplayLine` на строку добивает
 * повторную сегментацию кареток одной строки.
 */
export function paintCarets(
    context: RenderContext,
    viewState: EditorViewState,
    selections: readonly ISelection[],
    colors: ICaretColors,
    geo: ITextViewportGeometry,
): void {
    // Отсевы по вьюпорту ниже — про скорость, а не про картинку:
    // RenderContext.setCell клиппит по прямоугольнику элемента и на промахе
    // молча выходит, так что снятие границ отрисовку не меняет — меняется
    // только объём холостой работы. Мутанты в них неубиваемы — гасим оптом.
    // Stryker disable EqualityOperator,ConditionalExpression,LogicalOperator: см. выше
    const displayLineByDocLine = new Map<number, DisplayLine>();
    for (const selection of selections) {
        const row = viewState.viewLineForPosition(selection.active.line, selection.active.character);
        // Строка свёрнута фолдингом — каретке некуда встать.
        if (row < 0) continue;
        const screenY = row - geo.scrollTop;
        if (screenY < 0 || screenY >= geo.visibleLines) continue;

        // Кэш DisplayLine на строку — чистая мемоизация: без него результат
        // тот же, только пересчитанный на каждой каретке.
        // Stryker disable next-line CallExpression: см. выше
        let dl = displayLineByDocLine.get(selection.active.line);
        if (dl === undefined) {
            dl = viewState.displayLineFor(viewState.document.getLineContent(selection.active.line));
            // Stryker disable next-line CallExpression: заполнение кэша, результат не меняет
            displayLineByDocLine.set(selection.active.line, dl);
        }

        const localX =
            dl.offsetToColumn(selection.active.character) - viewState.viewLineStartColumn(row) - geo.scrollLeft;
        if (localX < 0 || localX >= geo.contentCols) continue;
        // Stryker restore EqualityOperator,ConditionalExpression,LogicalOperator

        context.setCell(geo.gutterW + localX, screenY, {
            fg: colors.fg,
            bg: colors.bg,
            style: StyleFlags.None,
        });
    }
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
    // Клик по гуттеру — колонка 0 РЯДА: у продолжения wrap это начало фрагмента.
    const fragStartCol = viewState.viewLineStartColumn(viewLine);
    const displayCol = fragStartCol + (localX < gutterW ? 0 : localX - gutterW + viewState.scrollLeft);
    const lineContent = viewState.document.getLineContent(logLine);
    const dl = viewState.displayLineFor(lineContent);
    let charOffset = dl.columnToOffset(displayCol);
    // Кламп к фрагменту ряда: клик правее конца не-последнего фрагмента не
    // должен утащить каретку на следующий ряд (offset границы принадлежит ему).
    // У рядов-зон и пустых строк frag.end = 0 — кламп не про них.
    const frag = viewState.viewLineRange(viewLine);
    if (frag.end > 0 && frag.end < lineContent.length && charOffset >= frag.end) {
        charOffset = dl.columnToOffset(dl.offsetToColumn(frag.end) - 1);
    }
    return { line: logLine, character: charOffset };
}
