import type { IRange } from "../../common/core/iRange.ts";
import { rangesEqual } from "../../common/core/iRange.ts";
import type { ISelection } from "../../common/core/iSelection.ts";
import { createCursorSelection, createSelection, isSelectionCollapsed, selectionToRange } from "../../common/core/iSelection.ts";
import type { EditorViewState } from "../../common/viewModel/editorViewState.ts";
import { findTextMatches } from "../find/findMatches.ts";

import type { IMultiCursorFindSession } from "./iMultiCursorFindSession.ts";
import {
    captureSession,
    deriveSearchSpec,
    findNextOccurrence,
    isSessionCurrent,
    selectionsShareText,
} from "./multiCursorSession.ts";

/**
 * Семейство «выделить следующее вхождение» (VS Code `editor/contrib/multicursor`).
 *
 * Тела команд живут здесь чистыми функциями над `EditorViewState`: состояние сессии — поле
 * модели, а вся стейт-машина — данные, которые легко покрыть юнит-тестами без DI и подписок.
 */

/** Выделение из диапазона, направленное слева направо. */
function selectionFromRange(range: IRange): ISelection {
    return createSelection(range.start.line, range.start.character, range.end.line, range.end.character);
}

/**
 * Живая сессия для очередного шага, либо `null` — шаг израсходован на подготовку
 * (первый Ctrl+D только выделяет слово под кареткой) или искать нечего.
 */
function ensureSession(viewState: EditorViewState): IMultiCursorFindSession | null {
    const versionId = viewState.document.versionId;
    const session = viewState.multiCursorSession;
    if (session !== null && isSessionCurrent(session, viewState.selections, versionId)) return session;

    viewState.multiCursorSession = null;
    const selections = viewState.selections;

    // Несколько кареток с РАЗНЫМ текстом: продолжать один поиск нечем — расширяем каждую
    // схлопнутую до слова под ней и на этом шаг заканчиваем (паритет с VS Code).
    if (selections.length > 1 && !selectionsShareText(viewState.document, selections, true)) {
        expandCollapsedToWords(viewState);
        return null;
    }

    const spec = deriveSearchSpec(viewState.document, selections[0]);
    if (spec === null) return null;

    const collapsed = isSelectionCollapsed(selections[0]);
    const base = collapsed ? [selectionFromRange(spec.range)] : selections;
    if (collapsed) {
        viewState.selections = base;
        viewState.revealSelection(viewState.selections[0]);
    }
    const captured = captureSession(spec, spec.range, viewState.selections, versionId);
    viewState.multiCursorSession = captured;

    // Первый Ctrl+D от каретки только выделяет слово — следующее вхождение добавит второй.
    return collapsed ? null : captured;
}

/** Каждое схлопнутое выделение расширяется до слова под ним; непустые не трогаем. */
function expandCollapsedToWords(viewState: EditorViewState): void {
    const expanded = viewState.selections.map((sel) => {
        if (!isSelectionCollapsed(sel)) return sel;
        const spec = deriveSearchSpec(viewState.document, sel);
        return spec === null ? sel : selectionFromRange(spec.range);
    });
    if (expanded.some((sel, i) => sel !== viewState.selections[i])) {
        viewState.selections = expanded;
    }
}

/**
 * Один шаг поиска. `mode: "add"` добавляет найденное вхождение новым выделением,
 * `"move"` переносит на него последнее добавленное (VS Code Ctrl+K Ctrl+D — «пропустить
 * это совпадение»).
 */
function step(viewState: EditorViewState, direction: 1 | -1, mode: "add" | "move"): void {
    const session = ensureSession(viewState);
    if (session === null) return;

    const selections = viewState.selections;
    const ranges = selections.map((sel) => selectionToRange(sel));
    // При переносе прежнее место освобождается — иначе поиск счёл бы его занятым и
    // на единственной паре вхождений команда встала бы намертво.
    const taken = mode === "add" ? ranges : ranges.filter((range) => !rangesEqual(range, session.lastAdded));

    const match = findNextOccurrence(viewState.document, session, session.lastAdded, direction, taken);
    if (match === null) return;

    const base =
        mode === "add"
            ? selections
            : selections.filter((sel) => !rangesEqual(selectionToRange(sel), session.lastAdded));
    const added = selectionFromRange(match);
    // Новое выделение — в хвосте: при слиянии направление наследуется от позже добавленного.
    viewState.selections = [...base, added];
    viewState.multiCursorSession = captureSession(session, match, viewState.selections, viewState.document.versionId);
    viewState.revealSelection(added);
}

/** Ctrl+D: выделить слово под кареткой, затем добавлять следующие вхождения. */
export function addSelectionToNextFindMatch(viewState: EditorViewState): void {
    step(viewState, 1, "add");
}

/** То же вверх по документу. */
export function addSelectionToPreviousFindMatch(viewState: EditorViewState): void {
    step(viewState, -1, "add");
}

/** Ctrl+K Ctrl+D: перенести последнее добавленное выделение на следующее вхождение. */
export function moveSelectionToNextFindMatch(viewState: EditorViewState): void {
    step(viewState, 1, "move");
}

/** То же вверх по документу. */
export function moveSelectionToPreviousFindMatch(viewState: EditorViewState): void {
    step(viewState, -1, "move");
}

/**
 * Ctrl+Shift+L: каретка на каждое вхождение разом. В отличие от Ctrl+D, шага «сначала
 * выделить слово» нет — от схлопнутой каретки сразу выделяются все вхождения её слова.
 *
 * Вьюпорт намеренно не двигаем: пользователь смотрит в конкретное место, и прыжок к
 * первичному (то есть самому верхнему) выделению увёз бы его в начало файла. Хотя бы одно
 * вхождение всегда есть — искомый текст взят из самого документа.
 */
export function selectHighlights(viewState: EditorViewState): void {
    const versionId = viewState.document.versionId;
    const session = viewState.multiCursorSession;
    const spec =
        session !== null && isSessionCurrent(session, viewState.selections, versionId)
            ? session
            : deriveSearchSpec(viewState.document, viewState.selections[0]);
    if (spec === null) return;

    const matches = findTextMatches(viewState.document, spec.searchText, {
        matchCase: spec.matchCase,
        wholeWord: spec.wholeWord,
    });
    viewState.selections = matches.map((range) => selectionFromRange(range));
    viewState.multiCursorSession = captureSession(spec, matches[matches.length - 1], viewState.selections, versionId);
}

/**
 * Ctrl+Shift+Alt+I: каретка в конец каждой строки, которую задевает выделение. Схлопнутые
 * выделения ничего не дают; у последней строки каретка появляется, только если выделение
 * реально в неё зашло (паритет с `getCursorsForSelection` в VS Code).
 */
export function insertCursorAtEndOfEachLineSelected(viewState: EditorViewState): void {
    const carets: ISelection[] = [];
    for (const selection of viewState.selections) {
        if (isSelectionCollapsed(selection)) continue;
        const range = selectionToRange(selection);
        for (let line = range.start.line; line < range.end.line; line++) {
            carets.push(createCursorSelection(line, viewState.document.getLineLength(line)));
        }
        if (range.end.character > 0) {
            carets.push(createCursorSelection(range.end.line, range.end.character));
        }
    }
    if (carets.length === 0) return;

    viewState.selections = carets;
    viewState.multiCursorSession = null;
    viewState.revealSelection(viewState.selections[0]);
}
