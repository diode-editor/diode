import type { ICommentRule } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import { createSelection, selectionToRange } from "../../common/core/iSelection.ts";
import type { ISelection } from "../../common/core/iSelection.ts";
import type { ITextEdit } from "../../common/core/iTextEdit.ts";
import { getLeadingWhitespace } from "../../common/languages/autoIndent.ts";
import type { IUndoElement } from "../../common/model/iUndoElement.ts";
import type { EditorViewState } from "../../common/viewModel/editorViewState.ts";

import { planToggleBlockComment } from "./blockComments.ts";
import type { IBlockCommentPlan } from "./blockComments.ts";
import { planLineComments, remapPositionForShifts } from "./lineComments.ts";
import type { ILineShift, LineCommentMode } from "./lineComments.ts";

/**
 * Команды комментирования (VS Code `editor/contrib/comment`) — чистые функции
 * над `EditorViewState`, как соседний `multiCursorCommands`. Токены приходят
 * снаружи (`ICommentRule` из language configuration активного языка); правки
 * всех выделений применяются одним undo-шагом, выделения после — переезжают
 * вслед за текстом, а не схлопываются.
 */

/** Строки, накрытые выделением; хвост на колонке 0 не в счёт (как в VS Code). */
function touchedLines(sel: ISelection): number[] {
    const range = selectionToRange(sel);
    let endLine = range.end.line;
    if (endLine > range.start.line && range.end.character === 0) {
        endLine--;
    }
    const lines: number[] = [];
    for (let line = range.start.line; line <= endLine; line++) lines.push(line);
    return lines;
}

/**
 * Выделения в документном порядке. Порядок гарантирует сам `EditorViewState`:
 * его сеттер прогоняет любой набор через `sortAndMergeSelections` (аналог
 * `CursorCollection.normalize` VS Code), так что мультикурсор, набранный снизу
 * вверх, доезжает сюда уже отсортированным — и накопление сдвигов от правок
 * соседей по строке считается слева направо.
 */
function inDocumentOrder(viewState: EditorViewState): readonly ISelection[] {
    return viewState.selections;
}

/** Toggle line comment (`editor.action.commentLine`, Ctrl+/). */
export function toggleLineComment(viewState: EditorViewState, comments: ICommentRule): IUndoElement | undefined {
    return runLineComments(viewState, comments, "toggle");
}

/** Add line comment (`editor.action.addCommentLine`, Ctrl+K Ctrl+C). */
export function addLineComment(viewState: EditorViewState, comments: ICommentRule): IUndoElement | undefined {
    return runLineComments(viewState, comments, "add");
}

/** Remove line comment (`editor.action.removeCommentLine`, Ctrl+K Ctrl+U). */
export function removeLineComment(viewState: EditorViewState, comments: ICommentRule): IUndoElement | undefined {
    return runLineComments(viewState, comments, "remove");
}

function runLineComments(
    viewState: EditorViewState,
    comments: ICommentRule,
    mode: LineCommentMode,
): IUndoElement | undefined {
    const lineComment = comments.lineComment;
    if (lineComment === undefined) {
        // Язык без построчного токена (CSS, HTML): toggle падает на блочные
        // токены вокруг содержимого строк — как в VS Code. Принудительные
        // add/remove без токена — no-op.
        return mode === "toggle" ? blockCommentLines(viewState, comments) : undefined;
    }

    const document = viewState.document;
    const usedLines = new Set<number>();
    const edits: ITextEdit[] = [];
    // Stryker disable next-line ArrayDeclaration: аккумулятор сдвигов; лишняя запись в нём
    // не наблюдаема — у неё нет строки, и remapPositionForShifts пропускает такую (shift.line !== pos.line)
    const shifts: ILineShift[] = [];
    for (const sel of inDocumentOrder(viewState)) {
        // Строки, уже разобранные предыдущим выделением, выпадают: два курсора
        // на одной строке комментируют её однажды. Пустой остаток безвреден —
        // план пустого набора строк пуст.
        const lines = touchedLines(sel).filter((line) => !usedLines.has(line));
        for (const line of lines) usedLines.add(line);

        const plan = planLineComments((line) => document.getLineContent(line), lines, lineComment, mode);
        if (plan !== null) {
            edits.push(...plan.edits);
            shifts.push(...plan.shifts);
        }
    }

    const remapped = viewState.selections.map((sel) => {
        const anchor = remapPositionForShifts(sel.anchor, shifts);
        const active = remapPositionForShifts(sel.active, shifts);
        return createSelection(anchor.line, anchor.character, active.line, active.character);
    });

    // Метка шага истории по режиму: toggleLineComment / addLineComment / removeLineComment.
    const element = viewState.applyEdits(edits, `${mode}LineComment`);
    if (element === undefined) return undefined;
    viewState.restoreSelections(remapped);
    return { ...element, afterSelections: viewState.cloneSelections() };
}

/** Toggle block comment (`editor.action.blockComment`, Shift+Alt+A). */
export function toggleBlockComment(viewState: EditorViewState, comments: ICommentRule): IUndoElement | undefined {
    const pair = comments.blockComment;
    if (pair === undefined) return undefined;

    const plans = inDocumentOrder(viewState).map((sel) =>
        planToggleBlockComment(viewState.document, selectionToRange(sel), pair[0], pair[1]),
    );
    return applyBlockCommentPlans(viewState, plans, "blockComment");
}

/** Line-comment-фолбэк для языков без построчного токена: блочная пара вокруг содержимого строк. */
function blockCommentLines(viewState: EditorViewState, comments: ICommentRule): IUndoElement | undefined {
    const pair = comments.blockComment;
    if (pair === undefined) return undefined;

    const document = viewState.document;
    const plans = inDocumentOrder(viewState).map((sel) => {
        const lines = touchedLines(sel);
        const firstLine = lines[0];
        const lastLine = lines[lines.length - 1];
        const range = {
            start: { line: firstLine, character: getLeadingWhitespace(document.getLineContent(firstLine)).length },
            end: { line: lastLine, character: document.getLineLength(lastLine) },
        };
        return planToggleBlockComment(document, range, pair[0], pair[1]);
    });
    return applyBlockCommentPlans(viewState, plans, "toggleLineComment");
}

/**
 * Применяет планы всех выделений одним undo-шагом и восстанавливает
 * выделения из планов. Планы построены в изоляции друг от друга — правки
 * ПРЕДЫДУЩИХ планов на той же строке сдвигают выделение более позднего
 * (блочные токены переводов строки не содержат, так что дрейф всегда
 * почтрочный и только по колонкам).
 */
function applyBlockCommentPlans(
    viewState: EditorViewState,
    plans: readonly IBlockCommentPlan[],
    label: string,
): IUndoElement | undefined {
    const edits: ITextEdit[] = [];
    const selections: ISelection[] = [];
    const lineDeltas = new Map<number, number>();
    for (const plan of plans) {
        const shift = (line: number): number => lineDeltas.get(line) ?? 0;
        selections.push(
            createSelection(
                plan.selection.anchor.line,
                plan.selection.anchor.character + shift(plan.selection.anchor.line),
                plan.selection.active.line,
                plan.selection.active.character + shift(plan.selection.active.line),
            ),
        );
        for (const edit of plan.edits) {
            edits.push(edit);
            const width = edit.range.end.character - edit.range.start.character;
            const line = edit.range.start.line;
            lineDeltas.set(line, (lineDeltas.get(line) ?? 0) + edit.text.length - width);
        }
    }
    const element = viewState.applyEdits(edits, label);
    if (element === undefined) return undefined;
    viewState.restoreSelections(selections);
    return { ...element, afterSelections: viewState.cloneSelections() };
}
