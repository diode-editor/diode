import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { parseWireEditorLayout, parseWireSelections, reviveWireUri } from "./wireTypes.ts";

describe("WireTypes — parseWireSelections", () => {
    it("оставляет валидные, отбрасывает битые", () => {
        const raw = [
            { anchorLine: 0, anchorCharacter: 1, activeLine: 2, activeCharacter: 3 },
            { anchorLine: 0, anchorCharacter: 1, activeLine: 2 }, // неполный
            null,
        ];
        expect(parseWireSelections(raw)).toEqual([
            { anchorLine: 0, anchorCharacter: 1, activeLine: 2, activeCharacter: 3 },
        ]);
    });

    it("не-массив → []", () => {
        expect(parseWireSelections(undefined)).toEqual([]);
    });
});

// ─── Editor layout (полоса групп, window.tabGroups) ──────────────────────────

/** Минимальная валидная текстовая вкладка снимка. */
function layoutTab(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { uri: "file:///p/a.ts", label: "a.ts", isActive: true, isDirty: false, kind: "text", ...overrides };
}

/** Снимок с одной группой и переданными вкладками. */
function layoutOf(...tabs: Record<string, unknown>[]): Record<string, unknown> {
    return { groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs }] };
}

describe("WireTypes — parseWireEditorLayout", () => {
    it("парсит группы с текстовыми вкладками (обязательные поля)", () => {
        const raw = layoutOf(layoutTab(), layoutTab({ uri: "file:///p/b.ts", label: "b.ts", isActive: false }));
        expect(parseWireEditorLayout(raw)).toEqual(raw);
    });

    it("принимает вкладку чужого вида (kind=unknown)", () => {
        const raw = layoutOf(layoutTab({ uri: "keybindings:global", kind: "unknown" }));
        expect(parseWireEditorLayout(raw)).toEqual(raw);
    });

    it("подхватывает опциональные original/modified/languageId/selections diff-вкладки", () => {
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

    it("нестроковые original/modified/languageId и не-массив selections опускаются", () => {
        const parsed = parseWireEditorLayout(
            layoutOf(layoutTab({ original: 5, modified: null, languageId: 42, selections: "junk" })),
        );
        expect(parsed?.groups[0].tabs[0]).toEqual(layoutTab());
    });

    it("битые выделения внутри selections отбрасываются поштучно (drop+skip)", () => {
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

    it("не-объект и groups-не-массив → null", () => {
        expect(parseWireEditorLayout(null)).toBeNull();
        expect(parseWireEditorLayout("junk")).toBeNull();
        expect(parseWireEditorLayout({})).toBeNull();
        expect(parseWireEditorLayout({ groups: "x" })).toBeNull();
    });

    it("битая группа роняет весь снимок → null (снимок должен быть атомарным)", () => {
        const good = { groupId: 1, viewColumn: 1, isActive: true, tabs: [] };
        expect(parseWireEditorLayout({ groups: [null] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [good, { ...good, groupId: "x" }] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [{ ...good, viewColumn: Number.NaN }] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [{ ...good, isActive: 1 }] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [{ ...good, tabs: "x" }] })).toBeNull();
    });

    it("битая вкладка роняет весь снимок → null", () => {
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
    it("строка → Uri.parse", () => {
        expect(reviveWireUri("file:///p/a.ts")?.toString()).toBe(Uri.file("/p/a.ts").toString());
    });

    it("компонентный JSON (toJSON-форма vscode.Uri) поднимается со всеми полями", () => {
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

    it("нестроковые компоненты опускаются, scheme обязателен", () => {
        const revived = reviveWireUri({ scheme: "diode", authority: 5, path: null, query: [], fragment: {} });
        expect(revived?.scheme).toBe("diode");
        expect(revived?.authority).toBe("");
        expect(revived?.path).toBe("");
        expect(revived?.query).toBe("");
        expect(revived?.fragment).toBe("");
    });

    it("мусор → null: пустая строка, не-объект, объект без scheme", () => {
        expect(reviveWireUri("")).toBeNull();
        expect(reviveWireUri(null)).toBeNull();
        expect(reviveWireUri(42)).toBeNull();
        expect(reviveWireUri({})).toBeNull();
        expect(reviveWireUri({ scheme: "" })).toBeNull();
        expect(reviveWireUri({ scheme: 5 })).toBeNull();
    });
});
