import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { parseWireEditorLayout, parseWireSelections, reviveWireUri } from "./wireTypes.ts";

describe("WireTypes — parseWireSelections", () => {
    it("keeps valid entries, drops broken ones", () => {
        const raw = [
            { anchorLine: 0, anchorCharacter: 1, activeLine: 2, activeCharacter: 3 },
            { anchorLine: 0, anchorCharacter: 1, activeLine: 2 }, // incomplete
            null,
        ];
        expect(parseWireSelections(raw)).toEqual([
            { anchorLine: 0, anchorCharacter: 1, activeLine: 2, activeCharacter: 3 },
        ]);
    });

    it("non-array → []", () => {
        expect(parseWireSelections(undefined)).toEqual([]);
    });
});

function layoutTab(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { uri: "file:///p/a.ts", label: "a.ts", isActive: true, isDirty: false, kind: "text", ...overrides };
}

function layoutOf(...tabs: Record<string, unknown>[]): Record<string, unknown> {
    return { groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs }] };
}

describe("WireTypes — parseWireEditorLayout", () => {
    it("parses groups with text tabs (required fields)", () => {
        const raw = layoutOf(layoutTab(), layoutTab({ uri: "file:///p/b.ts", label: "b.ts", isActive: false }));
        expect(parseWireEditorLayout(raw)).toEqual(raw);
    });

    it("accepts a tab of a foreign kind (kind=unknown)", () => {
        const raw = layoutOf(layoutTab({ uri: "keybindings:global", kind: "unknown" }));
        expect(parseWireEditorLayout(raw)).toEqual(raw);
    });

    it("picks up optional original/modified/languageId/selections of a diff tab", () => {
        const raw = layoutOf(
            layoutTab({
                kind: "diff",
                original: "git:///p/a.ts",
                modified: "file:///p/a.ts",
                languageId: "typescript",
                selections: [{ anchorLine: 0, anchorCharacter: 1, activeLine: 2, activeCharacter: 3 }],
            }),
        );
        expect(parseWireEditorLayout(raw)).toEqual(raw);
    });

    it("diff tab sideEditors: strings stay, garbage inside is dropped, a non-array is omitted", () => {
        const raw = layoutOf(
            layoutTab({ kind: "diff", sideEditors: ["file:///p/a.ts", 5, "_claude_fs_right:/p/a.ts"] }),
        );
        expect(parseWireEditorLayout(raw)?.groups[0].tabs[0].sideEditors).toEqual([
            "file:///p/a.ts",
            "_claude_fs_right:/p/a.ts",
        ]);
        expect(
            parseWireEditorLayout(layoutOf(layoutTab({ sideEditors: "file:///p/a.ts" })))?.groups[0].tabs[0],
        ).not.toHaveProperty("sideEditors");
    });

    it("non-string original/modified/languageId and non-array selections are omitted", () => {
        const parsed = parseWireEditorLayout(
            layoutOf(layoutTab({ original: 5, modified: null, languageId: 42, selections: "junk" })),
        );
        expect(parsed?.groups[0].tabs[0]).toEqual(layoutTab());
    });

    it("broken selections inside selections are dropped one by one (drop+skip)", () => {
        const parsed = parseWireEditorLayout(
            layoutOf(
                layoutTab({
                    selections: [null, { anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 2 }],
                }),
            ),
        );
        expect(parsed?.groups[0].tabs[0].selections).toEqual([
            { anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 2 },
        ]);
    });

    it("non-object and non-array groups → null", () => {
        expect(parseWireEditorLayout(null)).toBeNull();
        expect(parseWireEditorLayout("junk")).toBeNull();
        expect(parseWireEditorLayout({})).toBeNull();
        expect(parseWireEditorLayout({ groups: "x" })).toBeNull();
    });

    it("a broken group fails the whole snapshot → null (snapshot must be atomic)", () => {
        const good = { groupId: 1, viewColumn: 1, isActive: true, tabs: [] };
        expect(parseWireEditorLayout({ groups: [null] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [good, { ...good, groupId: "x" }] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [{ ...good, viewColumn: Number.NaN }] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [{ ...good, isActive: 1 }] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [{ ...good, tabs: "x" }] })).toBeNull();
    });

    it("a broken tab fails the whole snapshot → null", () => {
        expect(parseWireEditorLayout(layoutOf({}))).toBeNull();
        expect(
            parseWireEditorLayout({ groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [42] }] }),
        ).toBeNull();
        expect(parseWireEditorLayout(layoutOf(layoutTab({ uri: "" })))).toBeNull();
        expect(parseWireEditorLayout(layoutOf(layoutTab({ label: 5 })))).toBeNull();
        expect(parseWireEditorLayout(layoutOf(layoutTab({ isActive: "yes" })))).toBeNull();
        expect(parseWireEditorLayout(layoutOf(layoutTab({ isDirty: null })))).toBeNull();
        expect(parseWireEditorLayout(layoutOf(layoutTab({ kind: "webview" })))).toBeNull();
    });
});

describe("WireTypes — reviveWireUri", () => {
    it("string → Uri.parse", () => {
        expect(reviveWireUri("file:///p/a.ts")?.toString()).toBe(Uri.file("/p/a.ts").toString());
    });

    it("component JSON (toJSON form of vscode.Uri) is revived with all fields", () => {
        const revived = reviveWireUri({
            scheme: "git",
            authority: "host",
            path: "/p/a.ts",
            query: "ref=HEAD",
            fragment: "L1",
        });
        expect(revived?.scheme).toBe("git");
        expect(revived?.authority).toBe("host");
        expect(revived?.path).toBe("/p/a.ts");
        expect(revived?.query).toBe("ref=HEAD");
        expect(revived?.fragment).toBe("L1");
    });

    it("non-string components are omitted, scheme is required", () => {
        const revived = reviveWireUri({ scheme: "diode", authority: 5, path: null, query: [], fragment: {} });
        expect(revived?.scheme).toBe("diode");
        expect(revived?.authority).toBe("");
        expect(revived?.path).toBe("");
        expect(revived?.query).toBe("");
        expect(revived?.fragment).toBe("");
    });

    it("garbage → null: empty string, non-object, object without scheme", () => {
        expect(reviveWireUri("")).toBeNull();
        expect(reviveWireUri(null)).toBeNull();
        expect(reviveWireUri(42)).toBeNull();
        expect(reviveWireUri({})).toBeNull();
        expect(reviveWireUri({ scheme: "" })).toBeNull();
        expect(reviveWireUri({ scheme: 5 })).toBeNull();
    });
});
