import { describe, expect, it } from "vitest";

import type { IMenuEntryGroup, ResolvedMenuEntry } from "../../../../platform/actions/common/menuRegistry.ts";

import { inlineActions, overflowEntries } from "./titleMenuEntries.ts";

function item(id: string, icon?: string): ResolvedMenuEntry {
    return { label: id, id, enabled: true, ...(icon !== undefined ? { icon } : {}) };
}

describe("titleMenuEntries", () => {
    it("кнопками — только пункты `navigation` с иконкой; пункты с иконкой других групп — в «⋯»", () => {
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

    it("кнопкой не становятся пункт без id и подменю с иконкой", () => {
        const noId: ResolvedMenuEntry = { label: "no id", icon: "+", enabled: true };
        const submenu: ResolvedMenuEntry = { type: "submenu", label: "sub", icon: "+", entries: [] };
        expect(inlineActions([{ group: "navigation", entries: [noId, submenu] }])).toStrictEqual([]);
    });

    it("опустевшая без кнопок группа `navigation` между другими не оставляет в «⋯» лишнего разделителя", () => {
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
