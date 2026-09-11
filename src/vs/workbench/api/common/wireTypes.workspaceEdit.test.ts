import { describe, expect, it } from "vitest";

import { parseWireApplyWorkspaceEditParams } from "./wireTypes.ts";

// Парсер параметров `workspace.applyEdit` (subprocess → host). Мусор с провода
// не должен превращаться в правку — и не должен ронять хендлер.

const EDIT = { range: { startLine: 0, startCharacter: 1, endLine: 2, endCharacter: 3 }, text: "x" };

describe("parseWireApplyWorkspaceEditParams", () => {
    it("валидные ресурсы проходят как есть", () => {
        expect(
            parseWireApplyWorkspaceEditParams({
                edits: [
                    { resource: "file:///a.ts", edits: [EDIT] },
                    { resource: "file:///b.ts", edits: [EDIT, EDIT] },
                ],
            }),
        ).toEqual([
            { resource: "file:///a.ts", edits: [EDIT] },
            { resource: "file:///b.ts", edits: [EDIT, EDIT] },
        ]);
    });

    it("мусор на любом уровне даёт пустой список, а не исключение", () => {
        expect(parseWireApplyWorkspaceEditParams(null)).toEqual([]);
        // `undefined` — отдельно от null: у него падает даже доступ к свойству.
        expect(parseWireApplyWorkspaceEditParams(undefined)).toEqual([]);
        expect(parseWireApplyWorkspaceEditParams("junk")).toEqual([]);
        expect(parseWireApplyWorkspaceEditParams({})).toEqual([]);
        expect(parseWireApplyWorkspaceEditParams({ edits: "junk" })).toEqual([]);
        expect(parseWireApplyWorkspaceEditParams({ edits: [null, undefined, "junk", 42] })).toEqual([]);
    });

    it("записи без строкового resource или без единой валидной правки отбрасываются", () => {
        expect(
            parseWireApplyWorkspaceEditParams({
                edits: [
                    { resource: 5, edits: [EDIT] },
                    { resource: "file:///empty.ts", edits: [] },
                    { resource: "file:///bad.ts", edits: [{ range: null, text: "x" }] },
                    { resource: "file:///ok.ts", edits: [EDIT] },
                ],
            }),
        ).toEqual([{ resource: "file:///ok.ts", edits: [EDIT] }]);
    });

    it("невалидные правки внутри ресурса отбрасываются поштучно", () => {
        expect(
            parseWireApplyWorkspaceEditParams({
                edits: [{ resource: "file:///a.ts", edits: [{ range: EDIT.range, text: 7 }, EDIT] }],
            }),
        ).toEqual([{ resource: "file:///a.ts", edits: [EDIT] }]);
    });
});
