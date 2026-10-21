import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { CharacterPair } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import type { IPosition } from "../../common/core/iPosition.ts";
import { comparePositions } from "../../common/core/iPosition.ts";
import { createRange, type IRange, rangeContainsPosition, rangesEqual } from "../../common/core/iRange.ts";
import type { SelectionRangeProvider } from "../../common/languages/iSelectionRangeSource.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

import { type IsCodeAt, provideBracketSelectionRanges } from "./bracketSelections.ts";
import { firstNonWhitespaceIndex, lastNonWhitespaceEnd } from "./lineText.ts";
import { provideWordSelectionRanges } from "./wordSelections.ts";

/** Настройки `editor.smartSelect.*` (upstream `SelectionRangesOptions`). */
export interface ISelectionRangesOptions {
    readonly selectLeadingAndTrailingWhitespace: boolean;
    readonly selectSubwords: boolean;
}

export interface ISelectionRangesInput {
    readonly document: ITextDocument;
    readonly uri: string;
    readonly positions: readonly IPosition[];
    readonly providers: readonly SelectionRangeProvider[];
    /** Для фоллбека без провайдеров. */
    readonly brackets: readonly CharacterPair[];
    readonly isCodeAt?: IsCodeAt;
    readonly options: ISelectionRangesOptions;
}

/**
 * Upstream `smartSelect.ts:provideSelectionRanges`: от внутреннего к внешнему,
 * каждый следующий строго содержит предыдущий. Ответ провайдера, не выровненный
 * по позициям, отбрасывается целиком.
 */
export async function provideSelectionRanges(
    input: ISelectionRangesInput,
    token: ICancellationToken,
): Promise<IRange[][]> {
    const { document, positions, options } = input;
    const request = { uri: input.uri, languageId: document.languageId, versionId: document.versionId, positions };
    const answers: Promise<readonly (readonly IRange[])[]>[] = input.providers.map((provider) =>
        provider.provideSelectionRanges(request, token).catch(() => []),
    );
    if (input.providers.length === 0) {
        answers.push(
            Promise.resolve(provideBracketSelectionRanges(document, positions, input.brackets, input.isCodeAt)),
        );
    }
    answers.push(Promise.resolve(provideWordSelectionRanges(document, positions, options.selectSubwords)));

    const raw: IRange[][] = positions.map(() => []);
    for (const answer of await Promise.all(answers)) {
        if (answer.length !== positions.length) continue;
        positions.forEach((position, i) => {
            for (const range of answer[i]) {
                if (rangeContainsPosition(range, position)) raw[i].push(range);
            }
        });
    }

    return raw.map((ranges) => {
        const chain = toChain(ranges);
        return options.selectLeadingAndTrailingWhitespace ? withLineTrivia(document, chain) : chain;
    });
}

function rangeContainsRange(outer: IRange, inner: IRange): boolean {
    return comparePositions(outer.start, inner.start) <= 0 && comparePositions(inner.end, outer.end) <= 0;
}

function strictlyContains(outer: IRange, inner: IRange): boolean {
    return rangeContainsRange(outer, inner) && !rangesEqual(outer, inner);
}

/** Диапазон, пересекающийся с предыдущим сбоку или равный ему, выпадает. */
function toChain(ranges: IRange[]): IRange[] {
    ranges.sort((a, b) => comparePositions(b.start, a.start) || comparePositions(a.end, b.end));
    const chain: IRange[] = [];
    for (const range of ranges) {
        const last = chain.at(-1);
        if (last === undefined || strictlyContains(range, last)) chain.push(range);
    }
    return chain;
}

/** Ступени «строки без отступа» и «строки целиком» — только строго между соседями. */
function withLineTrivia(document: ITextDocument, chain: readonly IRange[]): IRange[] {
    const result: IRange[] = [];
    let prev: IRange | undefined;
    for (const cur of chain) {
        if (prev !== undefined && (cur.start.line !== prev.start.line || cur.end.line !== prev.end.line)) {
            result.push(...lineSteps(document, prev, cur));
        }
        result.push(cur);
        prev = cur;
    }
    return result;
}

function lineSteps(document: ITextDocument, prev: IRange, cur: IRange): IRange[] {
    const steps: IRange[] = [];
    const first = firstNonWhitespaceIndex(document.getLineContent(prev.start.line));
    // Конец на строке из пробелов: хвост — 0, у эталона — «до начала строки».
    // Разнятся они, только если prev кончается ровно в начале такой строки.
    const last = lastNonWhitespaceEnd(document.getLineContent(prev.end.line));
    const trimmed = first === -1 ? null : createRange(prev.start.line, first, prev.end.line, last);
    if (trimmed !== null && strictlyContains(trimmed, prev) && strictlyContains(cur, trimmed)) {
        steps.push(trimmed);
    }
    const full = createRange(prev.start.line, 0, prev.end.line, document.getLineLength(prev.end.line));
    if (
        strictlyContains(full, prev) &&
        (trimmed === null || !rangesEqual(full, trimmed)) &&
        strictlyContains(cur, full)
    ) {
        steps.push(full);
    }
    return steps;
}
