import { describe, expect, it } from "vitest";

import { createRange } from "../../../editor/common/core/iRange.ts";

import { parseWireEditorLayout, parseWireEditorPropertiesChanged } from "./wireTypes.ts";

const wireRange = { start: { line: 0, character: 0 }, end: { line: 9, character: 4 } };

describe("parseWireEditorPropertiesChanged", () => {
    it("keeps the address and the ranges", () => {
        expect(parseWireEditorPropertiesChanged({ uri: "file:///a", groupId: 1, visibleRanges: [wireRange] })).toEqual({
            uri: "file:///a",
            groupId: 1,
            visibleRanges: [createRange(0, 0, 9, 4)],
        });
    });

    it("drops broken ranges, not the message: one broken range drops the list", () => {
        for (const visibleRanges of [[{}], [wireRange, {}], []]) {
            expect(parseWireEditorPropertiesChanged({ uri: "file:///a", groupId: 1, visibleRanges })).toStrictEqual({
                uri: "file:///a",
                groupId: 1,
            });
        }
    });

    it("keeps complete options and drops incomplete or mistyped ones, not the message", () => {
        const options = { tabSize: 2, insertSpaces: false, cursorStyle: 2 };
        expect(parseWireEditorPropertiesChanged({ uri: "file:///a", groupId: 1, options })).toEqual({
            uri: "file:///a",
            groupId: 1,
            options,
        });
        for (const broken of [
            null,
            7,
            { ...options, tabSize: "2" },
            { ...options, insertSpaces: 1 },
            { ...options, cursorStyle: undefined },
        ]) {
            expect(parseWireEditorPropertiesChanged({ uri: "file:///a", groupId: 1, options: broken })).toStrictEqual({
                uri: "file:///a",
                groupId: 1,
            });
        }
    });

    it("rejects a non-object and a message without an address", () => {
        expect(parseWireEditorPropertiesChanged(null)).toBeNull();
        expect(parseWireEditorPropertiesChanged("x")).toBeNull();
        expect(parseWireEditorPropertiesChanged({ groupId: 1 })).toBeNull();
        expect(parseWireEditorPropertiesChanged({ uri: "file:///a", groupId: "1" })).toBeNull();
    });
});

describe("parseWireEditorLayout: visible ranges of a diff's sides", () => {
    function layoutWithSides(sideVisibleRanges: unknown): unknown {
        const tab = { uri: "diff:a", label: "a", isActive: true, isDirty: false, kind: "diff", sideVisibleRanges };
        return { groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab] }] };
    }

    it("keeps one list per side", () => {
        const parsed = parseWireEditorLayout(layoutWithSides([[wireRange], [wireRange]]));
        expect(parsed?.groups[0].tabs[0].sideVisibleRanges).toEqual([
            [createRange(0, 0, 9, 4)],
            [createRange(0, 0, 9, 4)],
        ]);
    });

    it("a tab without ranges has no ranges property", () => {
        expect(parseWireEditorLayout(layoutWithSides(undefined))?.groups[0].tabs[0]).not.toHaveProperty(
            "visibleRanges",
        );
    });

    it("drops all sides when one side is broken or empty", () => {
        expect(parseWireEditorLayout(layoutWithSides([[wireRange], []]))?.groups[0].tabs[0]).not.toHaveProperty(
            "sideVisibleRanges",
        );
        expect(
            parseWireEditorLayout(layoutWithSides([[wireRange], [{ start: 1 }]]))?.groups[0].tabs[0],
        ).not.toHaveProperty("sideVisibleRanges");
    });
});
