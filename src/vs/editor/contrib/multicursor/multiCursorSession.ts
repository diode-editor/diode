import { comparePositions, positionsEqual } from "../../common/core/iPosition.ts";
import type { IRange } from "../../common/core/iRange.ts";
import { createRange, rangesEqual } from "../../common/core/iRange.ts";
import type { ISelection } from "../../common/core/iSelection.ts";
import { isSelectionCollapsed, selectionToRange } from "../../common/core/iSelection.ts";
import { findWordRangeAt } from "../../common/core/wordClassification.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";
import { findTextMatches } from "../find/findMatches.ts";

import type { IMultiCursorFindSession, IMultiCursorSearchSpec } from "./iMultiCursorFindSession.ts";

/** Case sensitivity of Ctrl+D is fixed; see {@link IMultiCursorSearchSpec.matchCase}. */
const MATCH_CASE = true;

export interface IDerivedSearch extends IMultiCursorSearchSpec {
    /** For a collapsed cursor, the word under it. */
    readonly range: IRange;
}

/** `null` for a multi-line selection: the line-by-line scanner cannot find it. */
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

/** `idealColumn` is ignored: it changes without moving the cursor (vertical navigation) and would reset the session spuriously. */
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

/** Capture right after assigning the selections. */
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

/** Wrapping around and skipping `taken` guarantee termination: once everything is selected, Ctrl+D is a no-op. */
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
    // Stryker disable next-line ConditionalExpression: the early exit is only a shortcut: on an empty set both loops below do nothing and the function returns null anyway
    if (matches.length === 0) return null;

    const isTaken = (candidate: IRange): boolean => taken.some((range) => rangesEqual(range, candidate));
    const ordered = direction === 1 ? matches : [...matches].reverse();
    const isAhead =
        direction === 1
            ? (candidate: IRange) => comparePositions(candidate.start, from.start) > 0
            : (candidate: IRange) => comparePositions(candidate.start, from.start) < 0;

    for (const candidate of ordered) {
        if (isAhead(candidate) && !isTaken(candidate)) return candidate;
    }
    for (const candidate of ordered) {
        if (!isAhead(candidate) && !isTaken(candidate)) return candidate;
    }
    return null;
}

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
    // Stryker disable next-line MethodExpression: narrowing to "all empty" changes nothing: if some but not all are empty, the texts differ anyway and the check below returns the same false
    if (texts.some((text) => text === null || text === "")) return false;
    return texts.every((text) => text === texts[0]);
}
