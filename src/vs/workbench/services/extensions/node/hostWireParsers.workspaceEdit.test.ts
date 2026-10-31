import { describe, expect, it } from "vitest";

import { parseWireApplyWorkspaceEditParams } from "./hostWireParsers.ts";

const EDIT = { range: { start: { line: 0, character: 1 }, end: { line: 2, character: 3 } }, text: "x" };

describe("parseWireApplyWorkspaceEditParams", () => {
    it("valid operations pass as is, in original order", () => {
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

    it("each option comes through on its own", () => {
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

    it("absent options are not invented: absent ≠ false", () => {
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

    it("mistyped/false option values are dropped, not coerced to boolean", () => {
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

    it("garbage params yield null, not an exception", () => {
        expect(parseWireApplyWorkspaceEditParams(null)).toBeNull();
        // `undefined` separately from null: even property access throws on it.
        expect(parseWireApplyWorkspaceEditParams(undefined)).toBeNull();
        expect(parseWireApplyWorkspaceEditParams("junk")).toBeNull();
        expect(parseWireApplyWorkspaceEditParams({})).toBeNull();
        expect(parseWireApplyWorkspaceEditParams({ ops: "junk" })).toBeNull();
        // The old shape (`edits`) yields null, not an empty set that would pass for a vacuous success.
        expect(parseWireApplyWorkspaceEditParams({ edits: [{ resource: "file:///a.ts", edits: [EDIT] }] })).toBeNull();
    });

    it("an empty operation set yields an empty list (distinct from garbage)", () => {
        expect(parseWireApplyWorkspaceEditParams({ ops: [] })).toEqual([]);
    });

    it.each([
        ["not an object", [null]],
        // `undefined` separately from null: even property access throws on it.
        ["undefined operation", [undefined]],
        ["string instead of operation", ["junk"]],
        ["unknown kind", [{ kind: "notebook", resource: "file:///a.ts" }]],
        // An unknown kind with rename fields must not slip through as a rename.
        ["unknown kind with from/to", [{ kind: "notebook", from: "file:///a.ts", to: "file:///b.ts" }]],
        ["missing kind", [{ resource: "file:///a.ts", edits: [EDIT] }]],
        ["non-string resource", [{ kind: "text", resource: 5, edits: [EDIT] }]],
        ["text operation without edits", [{ kind: "text", resource: "file:///a.ts", edits: [] }]],
        ["all edits are garbage", [{ kind: "text", resource: "file:///a.ts", edits: [{ range: null, text: "x" }] }]],
        ["create without resource", [{ kind: "create" }]],
        ["delete without resource", [{ kind: "delete", resource: 7 }]],
        ["rename without to", [{ kind: "rename", from: "file:///a.ts" }]],
        ["rename without from", [{ kind: "rename", to: "file:///a.ts" }]],
    ])("garbage operation (%s) rejects the whole set", (_name, ops) => {
        expect(parseWireApplyWorkspaceEditParams({ ops })).toBeNull();
        expect(
            parseWireApplyWorkspaceEditParams({
                ops: [{ kind: "text", resource: "file:///ok.ts", edits: [EDIT] }, ...ops],
            }),
        ).toBeNull();
    });

    it("invalid edits INSIDE a resource are dropped one by one (the client converter authors them)", () => {
        expect(
            parseWireApplyWorkspaceEditParams({
                ops: [{ kind: "text", resource: "file:///a.ts", edits: [{ range: EDIT.range, text: 7 }, EDIT] }],
            }),
        ).toEqual([{ kind: "text", resource: "file:///a.ts", edits: [EDIT] }]);
    });
});

describe("parseWireApplyWorkspaceEditParams — line endings and contents", () => {
    const parseOne = (op: Record<string, unknown>) => parseWireApplyWorkspaceEditParams({ ops: [op] })?.[0];
    const TEXT = { kind: "text", resource: "file:///a.ts", edits: [EDIT] };

    it.each([1, 2])("a text operation carries the line ending %s, also with no edits", (setEndOfLine) => {
        expect(parseOne({ ...TEXT, setEndOfLine })).toStrictEqual({ ...TEXT, setEndOfLine });
        expect(parseOne({ ...TEXT, edits: [], setEndOfLine })).toStrictEqual({ ...TEXT, edits: [], setEndOfLine });
    });

    it("junk in the line ending stays out", () => {
        expect(parseOne({ ...TEXT, setEndOfLine: 3 })).toStrictEqual(TEXT);
    });

    it("create carries binary contents as base64; junk stays out", () => {
        const CREATE = { kind: "create", resource: "file:///a.ts" };
        expect(parseOne({ ...CREATE, contentsBase64: "AAE=" })).toStrictEqual({ ...CREATE, contentsBase64: "AAE=" });
        expect(parseOne({ ...CREATE, contentsBase64: 1 })).toStrictEqual(CREATE);
    });

    it("rename's overwrite is a boolean or nothing", () => {
        const RENAME = { kind: "rename", from: "file:///a.ts", to: "file:///b.ts" };
        expect(parseOne({ ...RENAME, overwrite: "yes" })).toStrictEqual(RENAME);
    });
});
