import { describe, expect, it } from "vitest";

import { createRange } from "../../../editor/common/core/iRange.ts";

import {
    wireToCoreDefinitionLocations,
    wireToCoreHover,
    wireToCoreInlineCompletionItems,
    wireToCoreReferences,
    wireToCoreRenameLocation,
    wireToCoreResolvedCompletion,
    wireToCoreTextEdits,
} from "./wireTypes.ts";

// Ответы языковых провайдеров хост не разбирает — форму гарантирует
// сериализатор субпроцесса (languagesNamespace.*.test.ts). Здесь — только
// перевод проволочной формы в форму ядра.

const RANGE = { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 9 };

describe("wireTypes — wireToCoreDefinitionLocations", () => {
    it("переводит wire-диапазон в core IRange", () => {
        expect(wireToCoreDefinitionLocations([{ uri: "file:///ok.ts", range: RANGE }])).toEqual([
            { uri: "file:///ok.ts", range: createRange(2, 4, 2, 9) },
        ]);
    });
});

describe("wireTypes — wireToCoreReferences", () => {
    it("переводит wire-диапазон в core IRange, порядок ссылок сохраняется", () => {
        expect(
            wireToCoreReferences([
                { uri: "file:///b.ts", range: RANGE },
                { uri: "file:///a.ts", range: RANGE },
            ]),
        ).toEqual([
            { uri: "file:///b.ts", range: createRange(2, 4, 2, 9) },
            { uri: "file:///a.ts", range: createRange(2, 4, 2, 9) },
        ]);
    });
});

describe("wireTypes — wireToCoreHover", () => {
    it("переводит wire-диапазон в core IRange; hover без range остаётся без него", () => {
        expect(wireToCoreHover({ contents: ["сигнатура"], range: RANGE })).toEqual({
            contents: ["сигнатура"],
            range: createRange(2, 4, 2, 9),
        });
        expect(wireToCoreHover({ contents: ["документация"] })).toEqual({ contents: ["документация"] });
    });
});

describe("wireTypes — wireToCoreInlineCompletionItems", () => {
    it("переводит wire-диапазон в core-IRange", () => {
        expect(
            wireToCoreInlineCompletionItems([{ insertText: "console.log()", filterText: "console", range: RANGE }]),
        ).toStrictEqual([{ insertText: "console.log()", filterText: "console", range: createRange(2, 4, 2, 9) }]);
    });

    it("необязательные поля не материализуются", () => {
        expect(wireToCoreInlineCompletionItems([{ insertText: "x" }])).toStrictEqual([{ insertText: "x" }]);
    });
});

describe("wireTypes — wireToCoreTextEdits", () => {
    it("переводит wire-правки в core-правки с 0-based диапазоном, порядок сохраняется", () => {
        expect(
            wireToCoreTextEdits([
                { range: RANGE, text: "x" },
                { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, text: "" },
            ]),
        ).toEqual([
            { range: createRange(2, 4, 2, 9), text: "x" },
            { range: createRange(0, 0, 0, 0), text: "" },
        ]);
    });
});

describe("wireTypes — wireToCoreResolvedCompletion", () => {
    it("detail, documentation и правки-спутники доезжают; отсутствующие поля не материализуются", () => {
        expect(
            wireToCoreResolvedCompletion({
                detail: "(alias) greet",
                documentation: "Greets someone.",
                additionalEdits: [{ range: RANGE, text: "import x\n" }],
            }),
        ).toStrictEqual({
            detail: "(alias) greet",
            documentation: "Greets someone.",
            additionalEdits: [{ range: createRange(2, 4, 2, 9), text: "import x\n" }],
        });
        expect(wireToCoreResolvedCompletion({})).toStrictEqual({});
    });
});

describe("wireTypes — wireToCoreRenameLocation", () => {
    it("имя символа доезжает placeholder'ом", () => {
        expect(wireToCoreRenameLocation({ placeholder: "value" })).toEqual({ kind: "name", name: "value" });
    });

    it("отказ бьёт имя: провайдер, сказавший «здесь нельзя», поля ввода не открывает", () => {
        expect(wireToCoreRenameLocation({ rejectReason: "nope" })).toEqual({ kind: "reject", reason: "nope" });
        expect(wireToCoreRenameLocation({ placeholder: "value", rejectReason: "nope" })).toEqual({
            kind: "reject",
            reason: "nope",
        });
    });

    it("ни имени, ни причины — null (ядро спросит следующего провайдера)", () => {
        expect(wireToCoreRenameLocation({})).toBeNull();
    });
});
