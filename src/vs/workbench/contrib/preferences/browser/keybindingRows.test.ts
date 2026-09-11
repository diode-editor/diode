import { Point } from "@tuidom/core/common/geometryPromitives";
import type { FuzzyMatch } from "../../../../base/common/fuzzySearch.ts";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IFilteredKeybindingItem, IKeybindingItem } from "../common/keybindingsEditorModel.ts";

import type { IKeybindingRowStyles } from "./keybindingRows.ts";
import { buildKeybindingHeaderRow, buildKeybindingRow, describeKeybindingHeaderRow, describeKeybindingRow } from "./keybindingRows.ts";

const STYLES: IKeybindingRowStyles = {
    dimFg: "descriptionForeground",
    highlightFg: "list.highlightForeground",
    conflictFg: "editorWarning.foreground",
};

function match(indices: number[]): FuzzyMatch {
    return { score: 0, matchedIndices: indices };
}

function item(overrides: Partial<IKeybindingItem> = {}): IKeybindingItem {
    return {
        commandId: "save",
        title: "Save File",
        chord: parseChord("ctrl+s"),
        when: undefined,
        source: "default",
        hasConflict: false,
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

describe("конфликт", () => {
    it("прокидывается в раскладку и красит колонку Keybinding при сборке", () => {
        const layout = describeKeybindingRow(filtered({ hasConflict: true }), WIDTH);
        expect(layout.conflict).toBe(true);

        // Сборка с конфликтом не падает и несёт тот же текст (цвет — char-стили).
        const row = buildKeybindingRow("kb-0", layout, {
            dimFg: "descriptionForeground",
            highlightFg: "list.highlightForeground",
            conflictFg: "editorWarning.foreground",
        });
        expect(row.getText()).toBe(layout.text);
    });

    it("бесконфликтная строка флага не несёт", () => {
        expect(describeKeybindingRow(filtered(), WIDTH).conflict).toBe(false);
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

describe("describeKeybindingRow — колонка When и подсветка", () => {
    it("пустой when даёт пустую колонку (не литерал-плейсхолдер)", () => {
        const layout = describeKeybindingRow(filtered({ when: undefined }), WIDTH);
        expect(layout.text.slice(layout.whenSpan.start, layout.whenSpan.start + layout.whenSpan.length).trim()).toBe("");
    });

    it("подсветка последнего символа НЕполного title сохраняется (keptLength = длина title)", () => {
        // Короткий title целиком помещается: индекс последнего символа должен пройти фильтр.
        const layout = describeKeybindingRow(filtered({ title: "Ab" }, match([1])), WIDTH);
        expect(layout.matchIndices).toEqual([1]);
    });

    it("на обрезанном title индекс на границе keptLength отбрасывается (строгое <)", () => {
        // Длинный title обрезается; keptLength = длина видимого префикса − 1 (место под «…»).
        const title = "C".repeat(60);
        const layout = describeKeybindingRow(filtered({ title }, match([0, 1, 200])), WIDTH);
        const kept = title.length; // не важно — важно, что граничные/за-границей индексы уходят
        expect(layout.matchIndices).toEqual([0, 1]);
        expect(layout.matchIndices.every((i) => i < kept)).toBe(true);
        // Индекс ровно на keptLength и за ним отброшены — берём индекс в самом хвосте видимого.
        const boundary = describeKeybindingRow(filtered({ title }, match([0, layout.text.indexOf("…")])), WIDTH);
        expect(boundary.matchIndices).toEqual([0]);
    });
});

describe("buildKeybindingRow — покраска колонок", () => {
    function fgAt(row: ReturnType<typeof buildKeybindingRow>, col: number): number {
        return renderElement(row, WIDTH, 1, { themeVars: true }).getFgAt(new Point(col, 0));
    }

    it("несёт id и полный текст раскладки", () => {
        const layout = describeKeybindingRow(filtered({ when: "listFocus" }), WIDTH);
        const row = buildKeybindingRow("kb-0", layout, STYLES);
        expect(row.id).toBe("kb-0");
        expect(row.getText()).toBe(layout.text);
    });

    it("When и Source приглушены — их цвет отличается от команды", () => {
        const layout = describeKeybindingRow(filtered({ when: "listFocus", source: "extension" }), WIDTH);
        const row = buildKeybindingRow("kb-0", layout, STYLES);
        const commandFg = fgAt(row, 0);

        expect(fgAt(row, layout.whenSpan.start)).not.toBe(commandFg);
        expect(fgAt(row, layout.sourceSpan.start)).not.toBe(commandFg);
        // Ровно за колонкой When (символ разделителя) приглушение НЕ течёт — граница спана точная.
        expect(fgAt(row, layout.whenSpan.start + layout.whenSpan.length)).toBe(commandFg);
    });

    it("конфликт красит колонку Keybinding, обычная строка — нет", () => {
        const conflictRow = buildKeybindingRow("kb-c", describeKeybindingRow(filtered({ hasConflict: true }), WIDTH), STYLES);
        const plainRow = buildKeybindingRow("kb-p", describeKeybindingRow(filtered({ hasConflict: false }), WIDTH), STYLES);
        const key = describeKeybindingRow(filtered(), WIDTH).keySpan.start;

        expect(fgAt(conflictRow, key)).not.toBe(fgAt(plainRow, key));
    });

    it("совпавший символ title подсвечен — его цвет отличается от несопоставленного", () => {
        const highlighted = buildKeybindingRow("kb-h", describeKeybindingRow(filtered({}, match([0])), WIDTH), STYLES);
        const plain = buildKeybindingRow("kb-n", describeKeybindingRow(filtered({}, null), WIDTH), STYLES);

        expect(fgAt(highlighted, 0)).not.toBe(fgAt(plain, 0));
    });

    it("шапка приглушена — её цвет отличается от команды обычной строки", () => {
        const header = buildKeybindingHeaderRow("kbHeader", WIDTH, "descriptionForeground");
        const row = buildKeybindingRow("kb-0", describeKeybindingRow(filtered(), WIDTH), STYLES);

        expect(fgAt(header, 0)).not.toBe(fgAt(row, 0));
    });
});
