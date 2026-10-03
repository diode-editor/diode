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
            // id, никак не пересекающийся с title — чтобы матч по id можно было
            // отличить от матча по title.
            binding({ commandId: "zeta.workbenchThing", chord: parseChord("f8"), source: "user" }),
        ],
        [
            command("save", "Save File"),
            command("hover", "Show Hover"),
            command("custom", "My Custom"),
            command("zeta.workbenchThing", "Reveal Panel"),
            command("open", "Open File"),
        ],
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

    it("матч ТОЛЬКО по id команды (title не совпадает) проходит без подсветки", () => {
        // "workbench" есть в id zeta.workbenchThing, но не в title "Reveal Panel".
        const filtered = filterKeybindingItems(items, "workbench");

        expect(filtered.map((entry) => entry.item.commandId)).toEqual(["zeta.workbenchThing"]);
        expect(filtered[0].titleMatch).toBeNull();
    });

    it("матч ТОЛЬКО по display-форме биндинга (ни title, ни id) находит строку", () => {
        // "f6" не встречается ни в title "My Custom", ни в id "custom".
        const filtered = filterKeybindingItems(items, "f6");

        expect(filtered.map((entry) => entry.item.commandId)).toEqual(["custom"]);
        expect(filtered[0].titleMatch).toBeNull();
    });

    it("на маке комбинацию находят и по глифу, и словами (cmd / option): ⌘ с клавиатуры не набрать", () => {
        const mac = buildKeybindingItems(
            [
                binding({ commandId: "save", chord: parseChord("meta+s"), source: "default" }),
                binding({ commandId: "word", chord: parseChord("alt+left"), source: "default" }),
            ],
            [command("save", "Save File"), command("word", "Cursor Word Left")],
        );
        const ids = (query: string, style: "pc" | "mac") =>
            filterKeybindingItems(mac, query, style).map((entry) => entry.item.commandId);
        expect(ids("cmd+s", "mac")).toEqual(["save"]);
        expect(ids("⌘s", "mac")).toEqual(["save"]);
        expect(ids("option", "mac")).toEqual(["word"]);
        expect(ids("cmd+s", "pc")).toEqual([]); // на pc «Meta+S» — слова «cmd» в подписи нет
        expect(ids("meta+s", "pc")).toEqual(["save"]);
    });

    it("многословный запрос фильтрует по title (текст склеивается через пробел)", () => {
        const filtered = filterKeybindingItems(items, "reveal panel");
        expect(filtered.map((entry) => entry.item.commandId)).toEqual(["zeta.workbenchThing"]);
    });

    it("слова запроса — отдельные термы: порядок относительно title не важен", () => {
        // Склейка остатка запроса через пробел тут наблюдаема: «panelreveal»
        // подпоследовательностью в «Reveal Panel» не складывается.
        const filtered = filterKeybindingItems(items, "panel reveal");
        expect(filtered.map((entry) => entry.item.commandId)).toEqual(["zeta.workbenchThing"]);
    });

    it("найтись обязаны все термы", () => {
        expect(filterKeybindingItems(items, "reveal zebra")).toEqual([]);
    });

    it("подсветка title собирается из кусков по терму", () => {
        const [entry] = filterKeybindingItems(items, "rev panel");
        // «Reveal Panel»: `rev` → 0..2, `panel` → 7..11.
        expect(entry.titleMatch!.matchedIndices).toEqual([0, 1, 2, 7, 8, 9, 10, 11]);
    });

    it("лишние пробелы выдачу не меняют, хвостовой её не гасит", () => {
        for (const query of ["reveal panel", "reveal  panel", " reveal panel", "reveal panel "]) {
            expect(
                filterKeybindingItems(items, query).map((entry) => entry.item.commandId),
                query,
            ).toEqual(["zeta.workbenchThing"]);
        }
    });

    it("запрос из одних пробелов ведёт себя как пустой", () => {
        const filtered = filterKeybindingItems(items, "   ");

        expect(filtered).toHaveLength(items.length);
        expect(filtered.every((entry) => entry.titleMatch === null)).toBe(true);
    });

    it("точное совпадение по подписи идёт первым, а не по алфавиту", () => {
        // Регрессия: `Show Hover` термами находит и команды, у которых `show` и
        // `hover` нашлись где-то в id («Parameter Hints: Previous Signature» —
        // `editor.action.showPrevParameterHint`). В алфавитном порядке сама
        // «Show Hover» оказывалась последней, и рекордер правил чужую строку.
        const haystack = buildKeybindingItems(
            [],
            [
                command("editor.action.showPrevParameterHint", "Parameter Hints: Previous Signature"),
                command("workbench.files.action.showActiveFileInExplorer", "File: Reveal Active File in Explorer"),
                command("editor.action.showHover", "Show Hover"),
            ],
        );

        const filtered = filterKeybindingItems(haystack, "Show Hover");

        expect(filtered[0].item.commandId).toBe("editor.action.showHover");
        expect(filtered.map((entry) => entry.item.commandId)).toHaveLength(3);
    });

    it("совпадение по подписи выше совпадения только по id — даже при худших очках", () => {
        const haystack = buildKeybindingItems(
            [],
            [
                // Совпадение по id и очками выше (`save` с начала слова), и в
                // алфавите раньше: обогнать его может только надбавка за подпись.
                command("save", "Aaa Nothing"),
                // В подписи `save` набирается вразбивку — очки низкие.
                command("zzz.other", "Zzz Disavowed"),
            ],
        );

        expect(filterKeybindingItems(haystack, "save").map((entry) => entry.item.commandId)).toEqual([
            "zzz.other",
            "save",
        ]);
    });

    it("совпадение по id выше совпадения только по комбинации", () => {
        const haystack = buildKeybindingItems(
            // Строка с биндингом F6 стоит в алфавите первой — отсортировать её
            // вниз может только разница очков.
            [binding({ commandId: "mmm.plain", chord: parseChord("f6") })],
            [command("mmm.plain", "Aaa Other"), command("zzz.f6thing", "Bbb Nothing")],
        );

        expect(filterKeybindingItems(haystack, "f6").map((entry) => entry.item.commandId)).toEqual([
            "zzz.f6thing",
            "mmm.plain",
        ]);
    });

    it("при равных очках порядок остаётся исходным (сортировка стабильная)", () => {
        // Одинаковый title — одинаковые очки: порядок обязан остаться тем, что
        // задал buildKeybindingItems (title, затем id), иначе строки одной
        // команды разъехались бы по списку.
        const haystack = buildKeybindingItems([], [command("zzz.save", "Save File"), command("aaa.save", "Save File")]);

        expect(filterKeybindingItems(haystack, "save").map((entry) => entry.item.commandId)).toEqual([
            "aaa.save",
            "zzz.save",
        ]);
    });

    it("@source: оставляет свой отбор, а остаток разбирается на термы", () => {
        const filtered = filterKeybindingItems(items, "@source:user panel reveal");
        expect(filtered.map((entry) => entry.item.commandId)).toEqual(["zeta.workbenchThing"]);
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
        expect(user.map((entry) => entry.item.commandId).sort()).toEqual(["custom", "zeta.workbenchThing"]);

        const extension = filterKeybindingItems(items, "@source:extension hover");
        expect(extension.map((entry) => entry.item.commandId)).toEqual(["hover"]);

        // Источник-фильтр отсекает строки без биндинга (source null).
        expect(filterKeybindingItems(items, "@source:default open")).toEqual([]);
    });
});
