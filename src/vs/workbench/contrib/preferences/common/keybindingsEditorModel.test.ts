import { describe, expect, it } from "vitest";

import type { ICommandSnapshot } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IKeybindingEntrySnapshot } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { buildKeybindingItems, filterKeybindingItems } from "./keybindingsEditorModel.ts";

function binding(overrides: Partial<IKeybindingEntrySnapshot> & { commandId: string }): IKeybindingEntrySnapshot {
    return {
        chord: parseChord("ctrl+s"),
        when: undefined,
        source: "default",
        ...overrides,
    };
}

function command(id: string, title: string): ICommandSnapshot {
    return { id, title };
}

describe("buildKeybindingItems", () => {
    it("даёт строку на каждую запись реестра с title из реестра команд", () => {
        const items = buildKeybindingItems(
            [
                binding({ commandId: "save", chord: parseChord("ctrl+s") }),
                binding({ commandId: "save", chord: parseChord("ctrl+k s"), when: "textViewFocus" }),
            ],
            [command("save", "Save File")],
        );

        expect(items).toHaveLength(2);
        expect(items.every((item) => item.title === "Save File")).toBe(true);
        expect(items.map((item) => item.when)).toEqual([undefined, "textViewFocus"]);
    });

    it("команды без биндинга получают строку с chord null и без источника", () => {
        const items = buildKeybindingItems(
            [binding({ commandId: "save" })],
            [command("save", "Save File"), command("open", "Open File")],
        );

        const unbound = items.find((item) => item.commandId === "open");
        expect(unbound).toBeDefined();
        expect(unbound!.chord).toBeNull();
        expect(unbound!.source).toBeNull();
    });

    it("биндинг неизвестной команды показывается по её id", () => {
        const items = buildKeybindingItems([binding({ commandId: "ext.mystery" })], []);

        expect(items).toHaveLength(1);
        expect(items[0].title).toBe("ext.mystery");
    });

    it("сортирует по title, затем по id команды", () => {
        const items = buildKeybindingItems(
            [binding({ commandId: "z.cmd" }), binding({ commandId: "a.cmd" })],
            [command("z.cmd", "Alpha"), command("a.cmd", "Alpha"), command("m.cmd", "Beta")],
        );

        expect(items.map((item) => item.commandId)).toEqual(["a.cmd", "z.cmd", "m.cmd"]);
    });

    it("конфликтующие записи помечены, остальные — нет", () => {
        const items = buildKeybindingItems(
            [
                binding({ commandId: "save", chord: parseChord("ctrl+s") }),
                binding({ commandId: "other", chord: parseChord("ctrl+s") }),
                binding({ commandId: "hover", chord: parseChord("f1") }),
            ],
            [command("save", "Save"), command("other", "Other"), command("hover", "Hover"), command("free", "Free")],
        );

        expect(items.find((item) => item.commandId === "save")!.hasConflict).toBe(true);
        expect(items.find((item) => item.commandId === "other")!.hasConflict).toBe(true);
        expect(items.find((item) => item.commandId === "hover")!.hasConflict).toBe(false);
        // Строка без биндинга конфликтовать не может.
        expect(items.find((item) => item.commandId === "free")!.hasConflict).toBe(false);
    });

    it("источник записи доезжает до строки", () => {
        const items = buildKeybindingItems(
            [binding({ commandId: "save", source: "user" })],
            [command("save", "Save File")],
        );

        expect(items[0].source).toBe("user");
    });
});

describe("filterKeybindingItems", () => {
    const items = buildKeybindingItems(
        [
            binding({ commandId: "save", chord: parseChord("ctrl+s"), source: "default" }),
            binding({ commandId: "hover", chord: parseChord("ctrl+k ctrl+u"), source: "extension" }),
            binding({ commandId: "custom", chord: parseChord("f6"), source: "user" }),
        ],
        [command("save", "Save File"), command("hover", "Show Hover"), command("custom", "My Custom"), command("open", "Open File")],
    );

    it("пустой запрос пропускает всё без подсветки", () => {
        const filtered = filterKeybindingItems(items, "");

        expect(filtered).toHaveLength(items.length);
        expect(filtered.every((entry) => entry.titleMatch === null)).toBe(true);
    });

    it("fuzzy по title даёт подсветку", () => {
        const filtered = filterKeybindingItems(items, "savf");

        expect(filtered).toHaveLength(1);
        expect(filtered[0].item.commandId).toBe("save");
        expect(filtered[0].titleMatch).not.toBeNull();
        expect(filtered[0].titleMatch!.matchedIndices.length).toBe(4);
    });

    it("матч по id команды проходит без подсветки title", () => {
        const filtered = filterKeybindingItems(items, "hovr");

        const hover = filtered.find((entry) => entry.item.commandId === "hover");
        expect(hover).toBeDefined();
    });

    it("матч по display-форме биндинга находит строку", () => {
        const filtered = filterKeybindingItems(items, "f6");

        expect(filtered.some((entry) => entry.item.commandId === "custom")).toBe(true);
    });

    it("несовпавшее отфильтровывается", () => {
        expect(filterKeybindingItems(items, "zzzzzz")).toEqual([]);
    });

    it("@conflicts отбирает только конфликтующие; добавка комбинации сужает до её группы", () => {
        const conflicted = buildKeybindingItems(
            [
                binding({ commandId: "save", chord: parseChord("ctrl+s") }),
                binding({ commandId: "other", chord: parseChord("ctrl+s") }),
                binding({ commandId: "dupF6a", chord: parseChord("f6") }),
                binding({ commandId: "dupF6b", chord: parseChord("f6") }),
                binding({ commandId: "clean", chord: parseChord("f1") }),
            ],
            [],
        );

        const all = filterKeybindingItems(conflicted, "@conflicts");
        expect(all.map((entry) => entry.item.commandId).sort()).toEqual(["dupF6a", "dupF6b", "other", "save"]);

        const group = filterKeybindingItems(conflicted, "@conflicts f6");
        expect(group.map((entry) => entry.item.commandId).sort()).toEqual(["dupF6a", "dupF6b"]);
    });

    it("@source: отбирает по источнику, остаток запроса — fuzzy", () => {
        const user = filterKeybindingItems(items, "@source:user");
        expect(user.map((entry) => entry.item.commandId)).toEqual(["custom"]);

        const extension = filterKeybindingItems(items, "@source:extension hover");
        expect(extension.map((entry) => entry.item.commandId)).toEqual(["hover"]);

        // Источник-фильтр отсекает строки без биндинга (source null).
        expect(filterKeybindingItems(items, "@source:default open")).toEqual([]);
    });
});
