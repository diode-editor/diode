import type { IRange } from "../../common/core/iRange.ts";
import { rangesEqual } from "../../common/core/iRange.ts";
import type { ISelection } from "../../common/core/iSelection.ts";
import {
    createCursorSelection,
    createSelection,
    isSelectionCollapsed,
    selectionToRange,
} from "../../common/core/iSelection.ts";
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

function selectionFromRange(range: IRange): ISelection {
    return createSelection(range.start.line, range.start.character, range.end.line, range.end.character);
}

/** `null` — шаг израсходован на подготовку (первый Ctrl+D только выделяет слово) или искать нечего. */
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

    return collapsed ? null : captured;
}

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

/** `"move"` переносит на найденное последнее добавленное (VS Code Ctrl+K Ctrl+D). */
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

export function addSelectionToNextFindMatch(viewState: EditorViewState): void {
    step(viewState, 1, "add");
}

export function addSelectionToPreviousFindMatch(viewState: EditorViewState): void {
    step(viewState, -1, "add");
}

export function moveSelectionToNextFindMatch(viewState: EditorViewState): void {
    // Stryker disable next-line StringLiteral: step() сравнивает режим только с "add", поэтому "move" и любая другая строка идут одной ветвью — подмена ненаблюдаема
    step(viewState, 1, "move");
}

export function moveSelectionToPreviousFindMatch(viewState: EditorViewState): void {
    // Stryker disable next-line StringLiteral: см. moveSelectionToNextFindMatch — режим сравнивается только с "add"
    step(viewState, -1, "move");
}

/**
 * Вьюпорт намеренно не двигаем: прыжок к первичному (самому верхнему) выделению увёз бы
 * в начало файла. Хотя бы одно вхождение всегда есть — искомый текст взят из документа.
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

/** У последней строки каретка — только если выделение в неё зашло (`getCursorsForSelection` VS Code). */
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
