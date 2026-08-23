import { comparePositions, positionsEqual } from "../../common/core/iPosition.ts";
import type { IRange } from "../../common/core/iRange.ts";
import { createRange, rangesEqual } from "../../common/core/iRange.ts";
import type { ISelection } from "../../common/core/iSelection.ts";
import { isSelectionCollapsed, selectionToRange } from "../../common/core/iSelection.ts";
import { findWordRangeAt } from "../../common/core/wordClassification.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";
import { findTextMatches } from "../find/findMatches.ts";

import type { IMultiCursorFindSession, IMultiCursorSearchSpec } from "./iMultiCursorFindSession.ts";

/** Ось регистра у Ctrl+D зафиксирована — см. {@link IMultiCursorSearchSpec.matchCase}. */
const MATCH_CASE = true;

/** Что искать по выделению плюс диапазон, который это выделение должно занять. */
export interface IDerivedSearch extends IMultiCursorSearchSpec {
    /** Диапазон исходного вхождения: у схлопнутой каретки — слово под ней. */
    readonly range: IRange;
}

/**
 * Что и как искать, исходя из выделения. `null` — искать нечего: каретка не на слове
 * (пробел или пунктуация) либо выделение многострочное (построчный сканер такое не найдёт).
 *
 * Схлопнутая каретка даёт слово под собой и поиск по целым словам; непустое выделение —
 * свой текст и поиск по подстроке. Ровно как в VS Code.
 */
export function deriveSearchSpec(document: ITextDocument, selection: ISelection): IDerivedSearch | null {
    const range = selectionToRange(selection);
    if (range.start.line !== range.end.line) return null;

    const line = document.getLineContent(range.start.line);
    if (isSelectionCollapsed(selection)) {
        const word = findWordRangeAt(line, range.start.character);
        if (word === null) return null;
        return {
            searchText: line.slice(word.start, word.end),
            wholeWord: true,
            matchCase: MATCH_CASE,
            range: createRange(range.start.line, word.start, range.start.line, word.end),
        };
    }

    return {
        searchText: line.slice(range.start.character, range.end.character),
        wholeWord: false,
        matchCase: MATCH_CASE,
        range,
    };
}

/**
 * Сессия всё ещё описывает текущее состояние вью? Сравниваем по `anchor`/`active` и версии
 * документа; `idealColumn` игнорируем — он меняется мимо курсора (вертикальная навигация)
 * и ложно рвал бы сессию.
 */
export function isSessionCurrent(
    session: IMultiCursorFindSession,
    selections: readonly ISelection[],
    documentVersion: number,
): boolean {
    if (session.documentVersion !== documentVersion) return false;
    if (session.selectionsSnapshot.length !== selections.length) return false;
    return session.selectionsSnapshot.every(
        (snapshot, i) =>
            positionsEqual(snapshot.anchor, selections[i].anchor) &&
            positionsEqual(snapshot.active, selections[i].active),
    );
}

/** Снимок «эти выделения произвела сессия»; снимать сразу после присваивания. */
export function captureSession(
    spec: IMultiCursorSearchSpec,
    lastAdded: IRange,
    selections: readonly ISelection[],
    documentVersion: number,
): IMultiCursorFindSession {
    return {
        searchText: spec.searchText,
        wholeWord: spec.wholeWord,
        matchCase: spec.matchCase,
        lastAdded,
        selectionsSnapshot: selections.map((sel) => ({ anchor: sel.anchor, active: sel.active })),
        documentVersion,
    };
}

/**
 * Следующее вхождение от `from` в сторону `direction`, с заворотом через край документа;
 * диапазоны из `taken` пропускаются. `null` — вхождений нет вовсе или все уже выделены.
 *
 * Заворот и пропуск занятых вместе дают завершаемость: сколько ни жми Ctrl+D, после того
 * как выделены все вхождения, команда становится стабильным no-op.
 */
export function findNextOccurrence(
    document: ITextDocument,
    spec: IMultiCursorSearchSpec,
    from: IRange,
    direction: 1 | -1,
    taken: readonly IRange[],
): IRange | null {
    const matches = findTextMatches(document, spec.searchText, {
        matchCase: spec.matchCase,
        wholeWord: spec.wholeWord,
    });
    if (matches.length === 0) return null;

    const isTaken = (candidate: IRange): boolean => taken.some((range) => rangesEqual(range, candidate));
    const ordered = direction === 1 ? matches : [...matches].reverse();
    const isAhead =
        direction === 1
            ? (candidate: IRange) => comparePositions(candidate.start, from.start) > 0
            : (candidate: IRange) => comparePositions(candidate.start, from.start) < 0;

    // Сначала — от точки отсчёта до края документа, затем с другого края до неё же.
    for (const candidate of ordered) {
        if (isAhead(candidate) && !isTaken(candidate)) return candidate;
    }
    for (const candidate of ordered) {
        if (!isAhead(candidate) && !isTaken(candidate)) return candidate;
    }
    return null;
}

/**
 * Все выделения покрывают один и тот же текст? Гейт «Ctrl+D без живой сессии на нескольких
 * каретках»: если тексты разные, продолжать один поиск нечем и шаг уходит на расширение
 * кареток до слов под ними (паритет с VS Code).
 */
export function selectionsShareText(
    document: ITextDocument,
    selections: readonly ISelection[],
    matchCase: boolean,
): boolean {
    const texts = selections.map((sel) => {
        const range = selectionToRange(sel);
        if (range.start.line !== range.end.line) return null;
        const text = document.getLineContent(range.start.line).slice(range.start.character, range.end.character);
        return matchCase ? text : text.toLowerCase();
    });
    if (texts.some((text) => text === null || text === "")) return false;
    return texts.every((text) => text === texts[0]);
}
