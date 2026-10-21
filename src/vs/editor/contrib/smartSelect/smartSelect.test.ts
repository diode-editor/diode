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

describe("provideSelectionRanges: upstream merge", () => {
    it("no providers: word → inside brackets → brackets → line without indent → line → document", async () => {
        const text = "a\n  foo(bar)  \nb";
        expect(await steps(text, [createPosition(1, 7)])).toEqual([["bar", "(bar)", "foo(bar)", "  foo(bar)  ", text]]);
    });

    it("multi-line brackets: whole lines appear only when strictly between neighbors", async () => {
        const text = "f {\n  x\n}\n";
        expect(await steps(text, [createPosition(1, 2)])).toEqual([
            ["x", "  x", "\n  x\n", "{\n  x\n}", "f {\n  x\n}", text],
        ]);
    });

    it("tab counts as indent and trailing whitespace too", async () => {
        const text = "\tfoo(bar)\t\nb";
        expect(await steps(text, [createPosition(0, 6)])).toEqual([["bar", "(bar)", "foo(bar)", "\tfoo(bar)\t", text]]);
    });

    it("line steps also when the next range extends lines only up or only down", async () => {
        const text = "f {\n x y\n}\n";
        const caret = [createPosition(1, 1)];
        const up = provider(() => [[createRange(0, 0, 1, 4)]]);
        expect(await steps(text, caret, { providers: [up] })).toEqual([["x", "x y", " x y", "f {\n x y", text]]);
        const down = provider(() => [[createRange(1, 1, 2, 1)]]);
        expect(await steps(text, caret, { providers: [down] })).toEqual([["x", "x y", "x y\n}", " x y\n}", text]]);
    });

    it("next range on the same lines: no line steps between them", async () => {
        const text = "  foo bar  \nz";
        const lsp = provider(() => [[createRange(0, 0, 0, 9)]]);
        expect(await steps(text, [createPosition(0, 3)], { providers: [lsp] })).toEqual([
            ["foo", "  foo bar", "  foo bar  ", text],
        ]);
    });

    it("line without indent and trailing whitespace: whole line equals trimmed line, one step", async () => {
        const text = "a b\nc";
        expect(await steps(text, [createPosition(0, 0)])).toEqual([["a", "a b", text]]);
    });

    it("range from a whitespace-only line: no trimmed step, whole lines present", async () => {
        const text = "a\n  \nfoo\nb";
        const lsp = provider(() => [[createRange(1, 1, 2, 3), createRange(0, 0, 2, 3)]]);
        expect(await steps(text, [createPosition(2, 1)], { providers: [lsp] })).toEqual([
            ["foo", " \nfoo", "  \nfoo", "a\n  \nfoo", text],
        ]);
    });

    it("range from an empty line: no trimmed step, whole lines equal it and are not repeated", async () => {
        const text = "a\n\nfoo\nb";
        const lsp = provider(() => [[createRange(1, 0, 2, 3), createRange(0, 0, 2, 3)]]);
        expect(await steps(text, [createPosition(2, 1)], { providers: [lsp] })).toEqual([
            ["foo", "\nfoo", "a\n\nfoo", text],
        ]);
    });

    it("selectLeadingAndTrailingWhitespace: false means no line steps", async () => {
        const text = "a\n  foo(bar)  \nb";
        const options = { selectLeadingAndTrailingWhitespace: false, selectSubwords: true };
        expect(await steps(text, [createPosition(1, 7)], { options })).toEqual([["bar", "(bar)", text]]);
    });

    it("with a language provider the bracket fallback is silent, words always apply", async () => {
        const text = "x(fooBar)";
        const lsp = provider((positions) => positions.map(() => [createRange(0, 0, 0, 9)]));
        expect(await steps(text, [createPosition(0, 5)], { providers: [lsp] })).toEqual([["Bar", "fooBar", text]]);
        expect(lsp.provideSelectionRanges).toHaveBeenCalledWith(
            { uri: "file:///a.ts", languageId: "ts", versionId: 0, positions: [createPosition(0, 5)] },
            CancellationTokenNone,
        );
    });

    it("provider steps merge; ones missing the cursor or overlapping the previous one sideways drop out", async () => {
        const text = "aa bb cc dd";
        const lsp = provider(() => [
            [
                createRange(0, 0, 0, 5), // `aa bb`
                createRange(0, 9, 0, 11), // `dd` misses the cursor
                createRange(0, 3, 0, 8), // `bb cc` is narrower than `aa bb` and overlaps its side
            ],
        ]);
        expect(await steps(text, [createPosition(0, 4)], { providers: [lsp] })).toEqual([["bb", "bb cc", text]]);
    });

    it("provider failure and misaligned result mean no result, others are unaffected", async () => {
        const failing: SelectionRangeProvider = { provideSelectionRanges: () => Promise.reject(new Error("boom")) };
        const misaligned = provider(() => [[createRange(0, 0, 0, 3)], [createRange(0, 0, 0, 3)]]);
        expect(await steps("abc def", [createPosition(0, 5)], { providers: [failing, misaligned] })).toEqual([
            ["def", "abc def"],
        ]);
    });

    it("multi-cursor: one hierarchy per cursor", async () => {
        const text = "(ab) {cd}";
        expect(await steps(text, [createPosition(0, 1), createPosition(0, 7)])).toEqual([
            ["ab", "(ab)", text],
            ["cd", "{cd}", text],
        ]);
    });

    it("isCodeAt checks bracket lines", async () => {
        const text = 'f(")")';
        const isCodeAt = (_line: number, character: number): boolean => character < 2 || character > 4;
        expect(await steps(text, [createPosition(0, 4)], { isCodeAt })).toEqual([['")"', '(")")', text]]);
    });
});
