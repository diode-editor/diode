import type { IPosition } from "../../common/core/iPosition.ts";
import type { IRange } from "../../common/core/iRange.ts";
import { createRange } from "../../common/core/iRange.ts";
import type { ISelection } from "../../common/core/iSelection.ts";
import { createCursorSelection, createSelection } from "../../common/core/iSelection.ts";
import type { ITextEdit } from "../../common/core/iTextEdit.ts";
import { createTextEdit } from "../../common/core/iTextEdit.ts";

/**
 * Блочное комментирование (VS Code `BlockCommentCommand`): один диапазон —
 * один план. Чистые функции: на входе минимальный порт чтения документа и
 * нормализованный диапазон выделения, на выходе — правки и выделение после
 * них. Токены вставляются с пробелом между токеном и содержимым (VS Code
 * `editor.comments.insertSpace: true`), снимаются вместе с этим пробелом,
 * если он есть.
 */

export interface IBlockCommentDocument {
    getLineContent(line: number): string;
    getTextInRange(range: IRange): string;
}

export interface IBlockCommentPlan {
    readonly edits: readonly ITextEdit[];
    /** Выделение после применения правок (восстанавливается поверх дефолтного). */
    readonly selection: ISelection;
}

/**
 * Тоггл блочного комментария для одного выделения:
 *
 *  - пустое выделение внутри пары на своей строке → пара снимается;
 *  - пустое выделение вне пары → вставляется `/*∙∙*\/`, каретка между
 *    пробелами;
 *  - выделение, начинающееся открывающим и кончающееся закрывающим токеном →
 *    токены снимаются, выделение сжимается до содержимого;
 *  - выделение, обёрнутое токенами СНАРУЖИ (вплотную к границам) → снимаются
 *    наружные, выделение остаётся на своём тексте;
 *  - иначе выделение оборачивается парой и продолжает покрывать прежний текст.
 */
export function planToggleBlockComment(
    doc: IBlockCommentDocument,
    range: IRange,
    open: string,
    close: string,
): IBlockCommentPlan {
    if (range.start.line === range.end.line && range.start.character === range.end.character) {
        return planAtCursor(doc, range.start, open, close);
    }

    return (
        tryRemoveInside(doc, range, open, close) ??
        tryRemoveAround(doc, range, open, close) ??
        wrapRange(range, open, close)
    );
}

function planAtCursor(doc: IBlockCommentDocument, pos: IPosition, open: string, close: string): IBlockCommentPlan {
    const enclosing = findEnclosingComment(doc.getLineContent(pos.line), pos.character, open, close);
    if (enclosing !== null) {
        // Снятие — та же механика, что у выделения ровно по паре: строим
        // диапазон от открывающего токена до закрывающего и переиспользуем её,
        // а каретку проводим сквозь получившиеся правки. Проверять диапазон
        // нечего — он построен по НАЙДЕННОЙ паре, поэтому зовём снятие напрямую.
        const range = createRange(pos.line, enclosing.start, pos.line, enclosing.end);
        const plan = removeSurroundingTokens(range, doc.getTextInRange(range), open, close);
        return {
            edits: plan.edits,
            selection: createCursorSelection(pos.line, characterAfterEdits(pos.character, plan.edits)),
        };
    }

    const inserted = `${open}  ${close}`;
    return {
        edits: [createTextEdit(createRange(pos.line, pos.character, pos.line, pos.character), inserted)],
        selection: createCursorSelection(pos.line, pos.character + open.length + 1),
    };
}

/**
 * Границы пары, охватывающей каретку, в пределах её строки — `[start, end)`
 * вместе с токенами, либо `null`, если каретка вне пары. Границы принадлежат
 * самой паре: каретка на открывающем токене и вплотную за закрывающим (`/* x *\/|`)
 * считается внутри — как у парных скобок в VS Code.
 */
function findEnclosingComment(
    text: string,
    character: number,
    open: string,
    close: string,
): { readonly start: number; readonly end: number } | null {
    const openIdx = text.lastIndexOf(open, character);
    // Stryker disable next-line ConditionalExpression: ранний выход; без него диапазон поехал бы
    // от -1, но такой текст заведомо не начинается открывающим токеном и снятие всё равно отказало бы
    if (openIdx === -1) return null;
    // Закрывающий — первый, который начинается не раньше конца открывающего и
    // ещё касается каретки своим концом.
    const closeIdx = text.indexOf(close, Math.max(openIdx + open.length, character - close.length));
    // Stryker disable next-line ConditionalExpression,UnaryOperator: ранний выход, как и выше —
    // диапазон без закрывающего токена снятие отвергает; индекс 1 недостижим (поиск идёт от openIdx + длины токена ≥ 2)
    if (closeIdx === -1) return null;
    return { start: openIdx, end: closeIdx + close.length };
}

/**
 * Колонка после применения правок-удалений своей строки (координаты правок —
 * исходные, куски не пересекаются): точка внутри удалённого куска прижимается
 * к его началу, правее — едет влево на его длину.
 */
function characterAfterEdits(character: number, edits: readonly ITextEdit[]): number {
    let result = character;
    for (const edit of edits) {
        const start = edit.range.start.character;
        const length = edit.range.end.character - start;
        // Сколько символов куска осталось левее точки: ноль для точки левее
        // куска, вся длина — для точки правее него.
        result -= Math.min(Math.max(character - start, 0), length);
    }
    return result;
}

function tryRemoveInside(
    doc: IBlockCommentDocument,
    range: IRange,
    open: string,
    close: string,
): IBlockCommentPlan | null {
    const text = doc.getTextInRange(range);
    if (!text.startsWith(open) || !text.endsWith(close) || text.length < open.length + close.length) {
        return null;
    }
    return removeSurroundingTokens(range, text, open, close);
}

/**
 * Снимает токены с краёв диапазона, чей текст заведомо ими и ограничен
 * (`text` — содержимое `range`). Вместе с токеном уходит его пробел, если он
 * есть; выделение после правок покрывает то, что было внутри пары.
 */
function removeSurroundingTokens(range: IRange, text: string, open: string, close: string): IBlockCommentPlan {
    let openRun = open.length + (text[open.length] === " " ? 1 : 0);
    let closeRun = close.length + (text[text.length - close.length - 1] === " " ? 1 : 0);
    // Stryker disable next-line EqualityOperator: при равенстве обе ветки снимают ровно весь
    // текст выделения (объединение кусков — [0, length) в любом случае) и дают то же выделение
    if (openRun + closeRun > text.length) {
        // `/* */`: пробел между токенами один на двоих — не снимать его дважды.
        openRun = open.length;
        closeRun = text.length - open.length;
    }

    // Токены не содержат переводов строки: открывающий кусок целиком в первой
    // строке диапазона, закрывающий — в последней.
    const closeStartChar = range.end.character - closeRun;
    const edits = [
        createTextEdit(
            createRange(range.start.line, range.start.character, range.start.line, range.start.character + openRun),
            "",
        ),
        createTextEdit(createRange(range.end.line, closeStartChar, range.end.line, range.end.character), ""),
    ];

    const sameLine = range.end.line === range.start.line;
    const endChar = sameLine ? range.end.character - closeRun - openRun : closeStartChar;
    return {
        edits,
        selection: createSelection(range.start.line, range.start.character, range.end.line, endChar),
    };
}

function tryRemoveAround(
    doc: IBlockCommentDocument,
    range: IRange,
    open: string,
    close: string,
): IBlockCommentPlan | null {
    const before = doc.getLineContent(range.start.line).slice(0, range.start.character);
    const after = doc.getLineContent(range.end.line).slice(range.end.character);

    const openRun = before.endsWith(open + " ") ? open.length + 1 : before.endsWith(open) ? open.length : 0;
    const closeRun = after.startsWith(" " + close) ? close.length + 1 : after.startsWith(close) ? close.length : 0;
    if (openRun === 0 || closeRun === 0) return null;

    const edits = [
        createTextEdit(
            createRange(range.start.line, range.start.character - openRun, range.start.line, range.start.character),
            "",
        ),
        createTextEdit(
            createRange(range.end.line, range.end.character, range.end.line, range.end.character + closeRun),
            "",
        ),
    ];
    const sameLine = range.start.line === range.end.line;
    return {
        edits,
        selection: createSelection(
            range.start.line,
            range.start.character - openRun,
            range.end.line,
            sameLine ? range.end.character - openRun : range.end.character,
        ),
    };
}

function wrapRange(range: IRange, open: string, close: string): IBlockCommentPlan {
    const openText = open + " ";
    const closeText = " " + close;
    const edits = [
        createTextEdit(
            createRange(range.start.line, range.start.character, range.start.line, range.start.character),
            openText,
        ),
        createTextEdit(createRange(range.end.line, range.end.character, range.end.line, range.end.character), closeText),
    ];
    const sameLine = range.start.line === range.end.line;
    return {
        edits,
        selection: createSelection(
            range.start.line,
            range.start.character + openText.length,
            range.end.line,
            sameLine ? range.end.character + openText.length : range.end.character,
        ),
    };
}
