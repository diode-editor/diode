import { describe, expect, it } from "vitest";

import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IFilteredKeybindingItem, IKeybindingItem } from "../common/keybindingsEditorModel.ts";

import { buildKeybindingHeaderRow, buildKeybindingRow, describeKeybindingHeaderRow, describeKeybindingRow } from "./keybindingRows.ts";

function item(overrides: Partial<IKeybindingItem> = {}): IKeybindingItem {
    return {
        commandId: "save",
        title: "Save File",
        chord: parseChord("ctrl+s"),
        when: undefined,
        source: "default",
        ...overrides,
    };
}

function filtered(overrides: Partial<IKeybindingItem> = {}, titleMatch: IFilteredKeybindingItem["titleMatch"] = null): IFilteredKeybindingItem {
    return { item: item(overrides), titleMatch };
}

const WIDTH = 80;

describe("describeKeybindingRow", () => {
    it("колонки стоят на одинаковых позициях у всех строк", () => {
        const a = describeKeybindingRow(filtered({ title: "Short" }), WIDTH);
        const b = describeKeybindingRow(filtered({ title: "A much longer command title here" }), WIDTH);

        expect(a.keySpan.start).toBe(b.keySpan.start);
        expect(a.whenSpan.start).toBe(b.whenSpan.start);
        expect(a.sourceSpan.start).toBe(b.sourceSpan.start);
    });

    it("содержимое колонок читается по спанам", () => {
        const layout = describeKeybindingRow(
            filtered({ title: "Save File", when: "textViewFocus", source: "extension" }),
            WIDTH,
        );

        expect(layout.text.startsWith("Save File")).toBe(true);
        expect(layout.text.slice(layout.keySpan.start, layout.keySpan.start + layout.keySpan.length).trimEnd()).toBe("Ctrl+S");
        expect(layout.text.slice(layout.whenSpan.start, layout.whenSpan.start + layout.whenSpan.length).trimEnd()).toBe("textViewFocus");
        expect(layout.text.slice(layout.sourceSpan.start, layout.sourceSpan.start + layout.sourceSpan.length).trimEnd()).toBe("Extension");
    });

    it("строка без биндинга показывает тире и пустой источник", () => {
        const layout = describeKeybindingRow(filtered({ chord: null, source: null }), WIDTH);

        expect(layout.text.slice(layout.keySpan.start, layout.keySpan.start + layout.keySpan.length).trimEnd()).toBe("—");
        expect(layout.text.slice(layout.sourceSpan.start, layout.sourceSpan.start + layout.sourceSpan.length).trimEnd()).toBe("");
    });

    it("длинный title обрезается многоточием, не сдвигая колонки", () => {
        const title = "X".repeat(200);
        const layout = describeKeybindingRow(filtered({ title }), WIDTH);
        const short = describeKeybindingRow(filtered(), WIDTH);

        expect(layout.text).toContain("…");
        expect(layout.keySpan.start).toBe(short.keySpan.start);
    });

    it("подсветка не уезжает на многоточие: индексы за срезом отбрасываются", () => {
        const title = "Y".repeat(200);
        const match = { score: 0, matchedIndices: [0, 1, 150] };
        const layout = describeKeybindingRow(filtered({ title }, match), WIDTH);

        expect(layout.matchIndices).toEqual([0, 1]);
    });

    it("узкая вкладка не роняет раскладку: ширина клампится к минимуму таблицы", () => {
        const layout = describeKeybindingRow(filtered(), 10);

        expect(layout.keySpan.length).toBeGreaterThan(0);
        expect(layout.sourceSpan.length).toBeGreaterThan(0);
    });
});

describe("шапка таблицы", () => {
    it("колонки шапки совпадают с колонками строк", () => {
        const header = describeKeybindingHeaderRow(WIDTH);
        const row = describeKeybindingRow(filtered(), WIDTH);

        expect(header.startsWith("Command")).toBe(true);
        expect(header.slice(row.keySpan.start)).toMatch(/^Keybinding/);
        expect(header.slice(row.whenSpan.start)).toMatch(/^When/);
        expect(header.slice(row.sourceSpan.start)).toMatch(/^Source/);
    });

    it("buildKeybindingHeaderRow даёт строку с id и текстом шапки", () => {
        const row = buildKeybindingHeaderRow("kbHeader", WIDTH, "descriptionForeground");

        expect(row.id).toBe("kbHeader");
        expect(row.getText()).toBe(describeKeybindingHeaderRow(WIDTH));
    });
});

describe("buildKeybindingRow", () => {
    it("несёт id и полный текст раскладки", () => {
        const layout = describeKeybindingRow(filtered({ when: "listFocus" }), WIDTH);
        const row = buildKeybindingRow("kb-0", layout, {
            dimFg: "descriptionForeground",
            highlightFg: "list.highlightForeground",
        });

        expect(row.id).toBe("kb-0");
        expect(row.getText()).toBe(layout.text);
    });
});
