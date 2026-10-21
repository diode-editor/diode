import type { DisplayLine } from "@tuidom/core/common/displayLine";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";

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
}

/**
 * Аналог injected-text декораций upstream: текст, которого нет в документе, занимает
 * колонки внутри ОДНОЙ строки, и её хвост уезжает вправо. Один объект на кадр: отрисовка
 * и все overlay-проходы считают колонки по одной композитной строке, иначе подсветка
 * хвоста разъедется с самим хвостом.
 */
export interface ILinePhantom {
    readonly line: number;
    /** Фантомные колонки стоят ПЕРЕД этим документным offset'ом. */
    readonly offset: number;
    readonly text: string;
}

export function composedLineContent(phantom: ILinePhantom | null, line: number, lineContent: string): string {
    if (phantom?.line !== line) return lineContent;
    return lineContent.slice(0, phantom.offset) + phantom.text + lineContent.slice(phantom.offset);
}

/** Offset СИМВОЛА: символ на точке вставки уезжает вправо вместе с хвостом. */
export function composedOffset(phantom: ILinePhantom | null, line: number, offset: number): number {
    if (phantom?.line !== line || offset < phantom.offset) return offset;
    return offset + phantom.text.length;
}

/**
 * Offset ТОЧКИ ВСТАВКИ: в отличие от {@link composedOffset}, каретка на самой точке
 * остаётся СЛЕВА от подсказки (affinity injected-text у upstream).
 */
export function composedCaretOffset(phantom: ILinePhantom | null, line: number, offset: number): number {
    if (phantom?.line !== line || offset <= phantom.offset) return offset;
    return offset + phantom.text.length;
}

/** Клик по самим фантомным колонкам отдаёт точку вставки. */
export function documentOffset(phantom: ILinePhantom | null, line: number, offset: number): number {
    // Ровно на точке вставки обе ветки дают `phantom.offset` — мутант `<=` → `<` эквивалентен.
    // Stryker disable next-line EqualityOperator: см. выше
    if (phantom?.line !== line || offset <= phantom.offset) return offset;
    return Math.max(phantom.offset, offset - phantom.text.length);
}

/** Как {@link EditorViewState.viewLineStartColumn}, но по уже построенной композитной строке. */
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
        // По композитной строке, иначе подсветка уедет относительно хвоста после фантома.
        const dl = viewState.displayLineFor(composedLineContent(geo.phantom, logLine, lineContent));
        // Виртуальную ячейку перевода строки (+1 за концом) несёт только последний фрагмент.
        const frag = viewState.viewLineRange(viewLine);
        const isLastFragment = frag.end === lineContent.length;
        const rangeStartChar = logLine === range.start.line ? range.start.character : 0;
        const rangeEndChar = logLine === range.end.line ? range.end.character : lineContent.length + 1;
        const startChar = Math.max(rangeStartChar, frag.start);
        const endChar = Math.min(rangeEndChar, isLastFragment ? lineContent.length + 1 : frag.end);

        const fragStartCol = fragmentStartColumn(viewState, dl, geo.phantom, logLine, viewLine);
        const startCol = dl.offsetToColumn(composedOffset(geo.phantom, logLine, startChar)) - fragStartCol;
        const endCol =
            (endChar > lineContent.length
                ? dl.displayWidth + 1
                : dl.offsetToColumn(composedOffset(geo.phantom, logLine, endChar))) - fragStartCol;

        const screenXStart = Math.max(0, startCol - geo.scrollLeft);
        const screenXEnd = Math.min(geo.contentCols, endCol - geo.scrollLeft);

        for (let screenX = screenXStart; screenX < screenXEnd; screenX++) {
            visit(geo.gutterW + screenX, screenY);
        }
    }
}

/** Только `bg`: глиф и fg под подсветкой сохраняются. */
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
    /** Считает вызывающий — у него свой tabSize. */
    displayLine: DisplayLine;
    tokenIndex: TokenIndex | null;
    resolveStyle: (metadata: number) => ResolvedTokenStyle;
    /** Перекрывает TextMate только в атрибутах, заданных темой. */
    semanticIndex: SemanticTokenIndex | null;
    screenY: number;
    gutterW: number;
    contentCols: number;
    scrollLeft: number;
    /** Сдвигает «колоночное окно» строки при word wrap, как scrollLeft, но по-строчно. */
    startColumn: number;
    /** Дальше лежит текст СЛЕДУЮЩЕГО фрагмента — вместо него до края рисуются пробелы. */
    endColumnExclusive: number;
    fg: number;
    bg: number;
    /** У диффа — нет: фон строки added/deleted должен побеждать фон токена. */
    allowTokenBg: boolean;
    /** Слоты фантома токен не ищут, а offset'ы правее него пересчитываются в документные. */
    phantom: IPaintTextLinePhantom | null;
}

export interface IPaintTextLinePhantom {
    readonly startOffset: number;
    readonly length: number;
    readonly fg: number;
    readonly style: number;
}

/** Обход по ДИСПЛЕЙНЫМ колонкам — ради широких символов, табов и горизонтального скролла. */
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
        /* v8 ignore start -- defensive: колонки за концом строки (>= endColumnExclusive <= displayWidth) ушли в заливку выше, в отрисовываемом диапазоне слот есть всегда */
        // Stryker disable next-line ConditionalExpression,EqualityOperator,BlockStatement: недостижимый защитный гард, см. v8 ignore
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
            // Правее фантома композитный offset забегает вперёд документного.
            const offset = phantom !== null && slot.offset >= phantomEnd ? slot.offset - phantom.length : slot.offset;
            const metadata = tokenIndex?.metadataAt(offset);
            // Stryker disable next-line ConditionalExpression: без токена резолвер на `undefined` даёт пустой стиль — те же fg/bg/style
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
            // Grid/TerminalRenderer знают только width 1 и 2 — таб раскладываем на пробелы.
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
    /** Пакованные {@link StyleFlags}. */
    style: number;
}

/**
 * Строка-зона ghost text (`lines[1..]`); первая строка подсказки сюда не приходит —
 * она вклеивается фантомными колонками в свою строку ({@link ILinePhantom}).
 */
export function paintPhantomText(context: RenderContext, params: IPaintPhantomTextParams): void {
    const { displayLine, screenY, gutterW, contentCols, fg, bg, style } = params;

    let col = 0;
    // Отсев за концом строки — про скорость: RenderContext клиппит по прямоугольнику
    // элемента, мутанты границ неубиваемы.
    // Stryker disable next-line EqualityOperator: см. выше
    while (col < displayLine.displayWidth) {
        // Stryker disable next-line ConditionalExpression,EqualityOperator: клип по вьюпорту — про скорость, setCell за прямоугольником и так молча выходит
        if (col >= contentCols) break;
        const char = displayLine.charAtColumn(col);
        /* v8 ignore start -- defensive: col шагает по ширинам слотов от 0 и на колонку-продолжение широкого символа не попадает (в отличие от paintTextLine, где displayCol стартует с произвольного scrollLeft) */
        // Stryker disable ConditionalExpression,EqualityOperator,BlockStatement,StringLiteral,UpdateOperator: недостижимый защитный гард, см. v8 ignore
        if (char === "") {
            col++;
            continue;
        }
        // Stryker restore ConditionalExpression,EqualityOperator,BlockStatement,StringLiteral,UpdateOperator
        /* v8 ignore stop */
        const slot = displayLine.graphemeAtColumn(col);
        /* v8 ignore start -- defensive: в пределах displayWidth слот есть всегда (см. paintTextLine) */
        // Stryker disable ConditionalExpression,EqualityOperator,BlockStatement,UpdateOperator: недостижимый защитный гард, см. v8 ignore
        if (slot === undefined) {
            col++;
            continue;
        }
        // Stryker restore ConditionalExpression,EqualityOperator,BlockStatement,UpdateOperator
        /* v8 ignore stop */
        const width = slot.displayWidth;

        if (slot.grapheme === "\t") {
            // Пробелы таба неотличимы от фоновых пробелов хвоста: заливка нужна ради
            // невидимых на пробеле fg/style, наблюдаемо только шаг col — мутанты заливки неубиваемы.
            // Stryker disable ConditionalExpression,LogicalOperator,EqualityOperator,ArithmeticOperator,BlockStatement,ObjectLiteral,StringLiteral,CallExpression: см. выше
            for (let i = 0; i < width && col + i < contentCols; i++) {
                context.setCell(gutterW + col + i, screenY, { char: " ", fg, bg, style, width: 1 });
            }
            // Stryker restore ConditionalExpression,LogicalOperator,EqualityOperator,ArithmeticOperator,BlockStatement,ObjectLiteral,StringLiteral,CallExpression
            col += width;
        } else if (width === 2 && col + 1 >= contentCols) {
            // Пробел у края неотличим от фонового (см. таб выше); наблюдаемо лишь то, что
            // широкий символ НЕ нарисован.
            // Stryker disable next-line ArithmeticOperator,ObjectLiteral,StringLiteral,CallExpression: см. выше
            context.setCell(gutterW + col, screenY, { char: " ", fg, bg, style, width: 1 });
            col++;
        } else {
            context.setCell(gutterW + col, screenY, { char, fg, bg, style, width });
            col += width;
        }
    }
}

/** `null` — каретка вне видимой области. */
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
 * Аппаратный курсор терминала один — мультикурсор рисуем ячейками. Патч без
 * `char`/`width`: глиф сохраняется, а ячейку-продолжение широкого символа прокрашивает
 * `Grid.updateCell`. `style` сбрасывается явно — каретка не тащит bold/undercurl символа.
 */
export function paintCarets(
    context: RenderContext,
    viewState: EditorViewState,
    selections: readonly ISelection[],
    colors: ICaretColors,
    geo: ITextViewportGeometry,
): void {
    // Отсевы по вьюпорту ниже — про скорость: setCell клиппит по прямоугольнику элемента
    // и на промахе молча выходит. Мутанты в них неубиваемы.
    // Stryker disable EqualityOperator,ConditionalExpression,LogicalOperator: см. выше
    const displayLineByDocLine = new Map<number, DisplayLine>();
    for (const selection of selections) {
        const row = viewState.viewLineForPosition(selection.active.line, selection.active.character);
        if (row < 0) continue;
        const screenY = row - geo.scrollTop;
        if (screenY < 0 || screenY >= geo.visibleLines) continue;

        // Кэш DisplayLine на строку — чистая мемоизация.
        // Stryker disable next-line CallExpression: см. выше
        let dl = displayLineByDocLine.get(selection.active.line);
        if (dl === undefined) {
            dl = viewState.displayLineFor(
                composedLineContent(
                    geo.phantom,
                    selection.active.line,
                    viewState.document.getLineContent(selection.active.line),
                ),
            );
            // Stryker disable next-line CallExpression: заполнение кэша, результат не меняет
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

/** Клик по гуттеру маппится в колонку 0 ряда — как клик по номеру строки в VS Code. */
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
    // Строка-зона маппится в ближайшую документную, как view zone в VS Code.
    const logLine = viewState.docLineForViewLine(viewLine);
    const lineContent = viewState.document.getLineContent(logLine);
    const dl = viewState.displayLineFor(composedLineContent(phantom, logLine, lineContent));
    // У продолжения wrap колонка 0 ряда — начало фрагмента.
    const fragStartCol = fragmentStartColumn(viewState, dl, phantom, logLine, viewLine);
    const displayCol = fragStartCol + (localX < gutterW ? 0 : localX - gutterW + viewState.scrollLeft);
    let charOffset = documentOffset(phantom, logLine, dl.columnToOffset(displayCol));
    // Клик правее не-последнего фрагмента не должен утащить каретку на следующий ряд
    // (offset границы принадлежит ему). У зон и пустых строк frag.end = 0.
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
