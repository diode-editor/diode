import { describe, expect, it, vi } from "vitest";

import { CancellationTokenNone } from "../../../base/common/cancellation.ts";
import type { CharacterPair } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import { createPosition, type IPosition } from "../../common/core/iPosition.ts";
import { createRange, type IRange } from "../../common/core/iRange.ts";
import type { ISelectionRangeRequest, SelectionRangeProvider } from "../../common/languages/iSelectionRangeSource.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import { type ISelectionRangesInput, provideSelectionRanges } from "./smartSelect.ts";

const BRACKETS: readonly CharacterPair[] = [
    ["{", "}"],
    ["(", ")"],
];
const OPTIONS = { selectLeadingAndTrailingWhitespace: true, selectSubwords: true };

function provider(answer: (positions: readonly IPosition[]) => readonly (readonly IRange[])[]): SelectionRangeProvider {
    return {
        provideSelectionRanges: vi.fn((request: ISelectionRangeRequest) => Promise.resolve(answer(request.positions))),
    };
}

async function steps(
    text: string,
    positions: readonly IPosition[],
    overrides: Partial<ISelectionRangesInput> = {},
): Promise<string[][]> {
    const document = new TextDocument(text, "ts");
    const ranges = await provideSelectionRanges(
        { document, uri: "file:///a.ts", positions, providers: [], brackets: BRACKETS, options: OPTIONS, ...overrides },
        CancellationTokenNone,
    );
    return ranges.map((one) => one.map((range) => document.getTextInRange(range)));
}

describe("provideSelectionRanges — слияние эталона", () => {
    it("без провайдеров: слово → внутри скобок → скобки → строка без отступа → строка → документ", async () => {
        const text = "a\n  foo(bar)  \nb";
        expect(await steps(text, [createPosition(1, 7)])).toEqual([["bar", "(bar)", "foo(bar)", "  foo(bar)  ", text]]);
    });

    it("многострочные скобки: строки целиком появляются, только если строго между соседями", async () => {
        const text = "f {\n  x\n}\n";
        expect(await steps(text, [createPosition(1, 2)])).toEqual([
            ["x", "  x", "\n  x\n", "{\n  x\n}", "f {\n  x\n}", text],
        ]);
    });

    it("selectLeadingAndTrailingWhitespace: false — без ступеней строк", async () => {
        const text = "a\n  foo(bar)  \nb";
        const options = { selectLeadingAndTrailingWhitespace: false, selectSubwords: true };
        expect(await steps(text, [createPosition(1, 7)], { options })).toEqual([["bar", "(bar)", text]]);
    });

    it("с языковым провайдером скобочный фоллбек молчит, слова — всегда", async () => {
        const text = "x(fooBar)";
        const lsp = provider((positions) => positions.map(() => [createRange(0, 0, 0, 9)]));
        expect(await steps(text, [createPosition(0, 5)], { providers: [lsp] })).toEqual([["Bar", "fooBar", text]]);
        expect(lsp.provideSelectionRanges).toHaveBeenCalledWith(
            { uri: "file:///a.ts", languageId: "ts", versionId: 0, positions: [createPosition(0, 5)] },
            CancellationTokenNone,
        );
    });

    it("ступени провайдеров сливаются; мимо каретки и пересекающая предыдущую сбоку — выпадают", async () => {
        const text = "aa bb cc dd";
        const lsp = provider(() => [
            [
                createRange(0, 0, 0, 5), // «aa bb»
                createRange(0, 9, 0, 11), // «dd» — мимо каретки
                createRange(0, 3, 0, 8), // «bb cc» — уже, чем «aa bb», и пересекает его сбоку
            ],
        ]);
        expect(await steps(text, [createPosition(0, 4)], { providers: [lsp] })).toEqual([["bb", "bb cc", text]]);
    });

    it("сбой и невыровненный ответ провайдера — «ответа нет», остальные не страдают", async () => {
        const failing: SelectionRangeProvider = { provideSelectionRanges: () => Promise.reject(new Error("boom")) };
        const misaligned = provider(() => [[createRange(0, 0, 0, 3)], [createRange(0, 0, 0, 3)]]);
        expect(await steps("abc def", [createPosition(0, 5)], { providers: [failing, misaligned] })).toEqual([
            ["def", "abc def"],
        ]);
    });

    it("мультикурсор: по иерархии на каретку", async () => {
        const text = "(ab) {cd}";
        expect(await steps(text, [createPosition(0, 1), createPosition(0, 7)])).toEqual([
            ["ab", "(ab)", text],
            ["cd", "{cd}", text],
        ]);
    });

    it("строки скобок проверяет isCodeAt", async () => {
        const text = 'f(")")';
        const isCodeAt = (_line: number, character: number): boolean => character < 2 || character > 4;
        expect(await steps(text, [createPosition(0, 4)], { isCodeAt })).toEqual([['")"', '(")")', text]]);
    });
});
