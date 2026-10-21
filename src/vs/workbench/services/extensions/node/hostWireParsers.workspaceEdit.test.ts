import { describe, expect, it } from "vitest";

import { parseWireApplyWorkspaceEditParams } from "./hostWireParsers.ts";

const EDIT = { range: { start: { line: 0, character: 1 }, end: { line: 2, character: 3 } }, text: "x" };

describe("parseWireApplyWorkspaceEditParams", () => {
    it("валидные операции проходят как есть, в исходном порядке", () => {
        expect(
            parseWireApplyWorkspaceEditParams({
                ops: [
                    { kind: "create", resource: "file:///b.ts", contents: "seed" },
                    { kind: "text", resource: "file:///a.ts", edits: [EDIT] },
                    { kind: "text", resource: "file:///b.ts", edits: [EDIT, EDIT] },
                    { kind: "rename", from: "file:///a.ts", to: "file:///c.ts", overwrite: true },
                    { kind: "delete", resource: "file:///d.ts", ignoreIfNotExists: true },
                ],
            }),
        ).toEqual([
            { kind: "create", resource: "file:///b.ts", contents: "seed" },
            { kind: "text", resource: "file:///a.ts", edits: [EDIT] },
            { kind: "text", resource: "file:///b.ts", edits: [EDIT, EDIT] },
            { kind: "rename", from: "file:///a.ts", to: "file:///c.ts", overwrite: true },
            { kind: "delete", resource: "file:///d.ts", ignoreIfNotExists: true },
        ]);
    });

    it("каждая опция доезжает по отдельности", () => {
        expect(
            parseWireApplyWorkspaceEditParams({
                ops: [
                    { kind: "create", resource: "file:///b.ts", overwrite: true, ignoreIfExists: true },
                    { kind: "rename", from: "file:///a.ts", to: "file:///c.ts", ignoreIfExists: true },
                ],
            }),
        ).toEqual([
            { kind: "create", resource: "file:///b.ts", overwrite: true, ignoreIfExists: true },
            { kind: "rename", from: "file:///a.ts", to: "file:///c.ts", ignoreIfExists: true },
        ]);
    });

    it("опции без значения не выдумываются: отсутствие ≠ false", () => {
        expect(
            parseWireApplyWorkspaceEditParams({
                ops: [
                    { kind: "create", resource: "file:///b.ts" },
                    { kind: "delete", resource: "file:///d.ts" },
                    { kind: "rename", from: "file:///a.ts", to: "file:///c.ts" },
                ],
            }),
        ).toEqual([
            { kind: "create", resource: "file:///b.ts" },
            { kind: "delete", resource: "file:///d.ts" },
            { kind: "rename", from: "file:///a.ts", to: "file:///c.ts" },
        ]);
    });

    it("нестроковые/ложные значения опций отбрасываются, а не приводятся к boolean", () => {
        expect(
            parseWireApplyWorkspaceEditParams({
                ops: [
                    { kind: "create", resource: "file:///b.ts", contents: 42, overwrite: "yes", ignoreIfExists: false },
                    { kind: "delete", resource: "file:///d.ts", ignoreIfNotExists: 1 },
                ],
            }),
        ).toEqual([
            { kind: "create", resource: "file:///b.ts" },
            { kind: "delete", resource: "file:///d.ts" },
        ]);
    });

    it("мусор вместо параметров даёт null, а не исключение", () => {
        expect(parseWireApplyWorkspaceEditParams(null)).toBeNull();
        // `undefined` separately from null: even property access throws on it.
        expect(parseWireApplyWorkspaceEditParams(undefined)).toBeNull();
        expect(parseWireApplyWorkspaceEditParams("junk")).toBeNull();
        expect(parseWireApplyWorkspaceEditParams({})).toBeNull();
        expect(parseWireApplyWorkspaceEditParams({ ops: "junk" })).toBeNull();
        // The old shape (`edits`) yields null, not an empty set that would pass for a vacuous success.
        expect(parseWireApplyWorkspaceEditParams({ edits: [{ resource: "file:///a.ts", edits: [EDIT] }] })).toBeNull();
    });

    it("пустой набор операций — пустой список (отличим от мусора)", () => {
        expect(parseWireApplyWorkspaceEditParams({ ops: [] })).toEqual([]);
    });

    it.each([
        ["не объект", [null]],
        // `undefined` separately from null: even property access throws on it.
        ["операция undefined", [undefined]],
        ["строка вместо операции", ["junk"]],
        ["неизвестный kind", [{ kind: "notebook", resource: "file:///a.ts" }]],
        // An unknown kind with rename fields must not slip through as a rename.
        ["неизвестный kind с from/to", [{ kind: "notebook", from: "file:///a.ts", to: "file:///b.ts" }]],
        ["kind отсутствует", [{ resource: "file:///a.ts", edits: [EDIT] }]],
        ["нестроковый resource", [{ kind: "text", resource: 5, edits: [EDIT] }]],
        ["текстовая без правок", [{ kind: "text", resource: "file:///a.ts", edits: [] }]],
        ["все правки мусорные", [{ kind: "text", resource: "file:///a.ts", edits: [{ range: null, text: "x" }] }]],
        ["create без resource", [{ kind: "create" }]],
        ["delete без resource", [{ kind: "delete", resource: 7 }]],
        ["rename без to", [{ kind: "rename", from: "file:///a.ts" }]],
        ["rename без from", [{ kind: "rename", to: "file:///a.ts" }]],
    ])("мусорная операция (%s) отбивает весь набор", (_name, ops) => {
        expect(parseWireApplyWorkspaceEditParams({ ops })).toBeNull();
        expect(
            parseWireApplyWorkspaceEditParams({
                ops: [{ kind: "text", resource: "file:///ok.ts", edits: [EDIT] }, ...ops],
            }),
        ).toBeNull();
    });

    it("невалидные правки ВНУТРИ ресурса отбрасываются поштучно (их автор — конвертер клиента)", () => {
        expect(
            parseWireApplyWorkspaceEditParams({
                ops: [{ kind: "text", resource: "file:///a.ts", edits: [{ range: EDIT.range, text: 7 }, EDIT] }],
            }),
        ).toEqual([{ kind: "text", resource: "file:///a.ts", edits: [EDIT] }]);
    });
});
