import { describe, expect, it } from "vitest";

import type { IMenuEntryGroup, ResolvedMenuEntry } from "../../../../platform/actions/common/menuRegistry.ts";

import { inlineActions, overflowEntries } from "./titleMenuEntries.ts";

function item(id: string, icon?: string): ResolvedMenuEntry {
    return { label: id, id, enabled: true, ...(icon !== undefined ? { icon } : {}) };
}

describe("titleMenuEntries", () => {
    it("only `navigation` items with an icon become buttons; icon items of other groups go into ⋯", () => {
        const groups: IMenuEntryGroup[] = [
            { group: "1_other", entries: [item("other.icon", "*")] },
            { group: "navigation", entries: [item("nav.icon", "+"), item("nav.plain")] },
        ];
        expect(inlineActions(groups)).toStrictEqual([{ id: "nav.icon", icon: "+", enabled: true }]);
        expect(inlineActions(groups.slice(0, 1))).toStrictEqual([]);
        expect(overflowEntries(groups).map((entry) => (entry.type === "separator" ? "─" : entry.label))).toStrictEqual([
            "other.icon",
            "─",
            "nav.plain",
        ]);
    });

    it("an item without an id and a submenu with an icon do not become buttons", () => {
        const noId: ResolvedMenuEntry = { label: "no id", icon: "+", enabled: true };
        const submenu: ResolvedMenuEntry = { type: "submenu", label: "sub", icon: "+", entries: [] };
        expect(inlineActions([{ group: "navigation", entries: [noId, submenu] }])).toStrictEqual([]);
    });

    it("a `navigation` group emptied of buttons between others leaves no extra separator in ⋯", () => {
        const groups: IMenuEntryGroup[] = [
            { group: "1_first", entries: [item("first")] },
            { group: "navigation", entries: [item("nav.icon", "+")] },
            { group: "2_more", entries: [item("more")] },
        ];
        expect(overflowEntries(groups).map((entry) => (entry.type === "separator" ? "─" : entry.label))).toStrictEqual([
            "first",
            "─",
            "more",
        ]);
    });
});
