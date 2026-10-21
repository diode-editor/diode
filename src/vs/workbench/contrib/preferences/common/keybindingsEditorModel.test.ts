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
    it("yields a row per registry entry with the title from the command registry", () => {
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

    it("commands without a keybinding get a row with chord null and no source", () => {
        const items = buildKeybindingItems(
            [binding({ commandId: "save" })],
            [command("save", "Save File"), command("open", "Open File")],
        );

        const unbound = items.find((item) => item.commandId === "open");
        expect(unbound).toBeDefined();
        expect(unbound!.chord).toBeNull();
        expect(unbound!.source).toBeNull();
    });

    it("a keybinding of an unknown command is shown by its id", () => {
        const items = buildKeybindingItems([binding({ commandId: "ext.mystery" })], []);

        expect(items).toHaveLength(1);
        expect(items[0].title).toBe("ext.mystery");
    });

    it("sorts by title, then by command id", () => {
        const items = buildKeybindingItems(
            [binding({ commandId: "z.cmd" }), binding({ commandId: "a.cmd" })],
            [command("z.cmd", "Alpha"), command("a.cmd", "Alpha"), command("m.cmd", "Beta")],
        );

        expect(items.map((item) => item.commandId)).toEqual(["a.cmd", "z.cmd", "m.cmd"]);
    });

    it("conflicting entries are flagged, the rest are not", () => {
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
        // A row without a binding can't conflict.
        expect(items.find((item) => item.commandId === "free")!.hasConflict).toBe(false);
    });

    it("the entry's source reaches the row", () => {
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
            // An id that doesn't overlap with the title at all — so a match by id can be
            // told apart from a match by title.
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

    it("an empty query passes everything without highlights", () => {
        const filtered = filterKeybindingItems(items, "");

        expect(filtered).toHaveLength(items.length);
        expect(filtered.every((entry) => entry.titleMatch === null)).toBe(true);
    });

    it("fuzzy match on title gives highlights", () => {
        const filtered = filterKeybindingItems(items, "savf");

        expect(filtered).toHaveLength(1);
        expect(filtered[0].item.commandId).toBe("save");
        expect(filtered[0].titleMatch).not.toBeNull();
        expect(filtered[0].titleMatch!.matchedIndices.length).toBe(4);
    });

    it("a match ONLY on the command id (title does not match) passes without highlights", () => {
        // "workbench" is in the id zeta.workbenchThing, but not in the title "Reveal Panel".
        const filtered = filterKeybindingItems(items, "workbench");

        expect(filtered.map((entry) => entry.item.commandId)).toEqual(["zeta.workbenchThing"]);
        expect(filtered[0].titleMatch).toBeNull();
    });

    it("a match ONLY on the keybinding's display form (neither title nor id) finds the row", () => {
        // "f6" occurs neither in the title "My Custom" nor in the id "custom".
        const filtered = filterKeybindingItems(items, "f6");

        expect(filtered.map((entry) => entry.item.commandId)).toEqual(["custom"]);
        expect(filtered[0].titleMatch).toBeNull();
    });

    it("on mac a combination is found both by glyph and by words (cmd / option): ⌘ cannot be typed on a keyboard", () => {
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
        expect(ids("cmd+s", "pc")).toEqual([]); // on pc it's "Meta+S" — the label has no "cmd" word
        expect(ids("meta+s", "pc")).toEqual(["save"]);
    });

    it("a multi-word query filters by title (text is joined with a space)", () => {
        const filtered = filterKeybindingItems(items, "reveal panel");
        expect(filtered.map((entry) => entry.item.commandId)).toEqual(["zeta.workbenchThing"]);
    });

    it("query words are separate terms: their order relative to the title does not matter", () => {
        // Gluing the query remainder with a space is observable here: "panelreveal"
        // is not a subsequence of "Reveal Panel".
        const filtered = filterKeybindingItems(items, "panel reveal");
        expect(filtered.map((entry) => entry.item.commandId)).toEqual(["zeta.workbenchThing"]);
    });

    it("all terms must match", () => {
        expect(filterKeybindingItems(items, "reveal zebra")).toEqual([]);
    });

    it("title highlights are assembled from per-term pieces", () => {
        const [entry] = filterKeybindingItems(items, "rev panel");
        expect(entry.titleMatch!.matchedIndices).toEqual([0, 1, 2, 7, 8, 9, 10, 11]);
    });

    it("extra spaces do not change the results, a trailing one does not clear them", () => {
        for (const query of ["reveal panel", "reveal  panel", " reveal panel", "reveal panel "]) {
            expect(
                filterKeybindingItems(items, query).map((entry) => entry.item.commandId),
                query,
            ).toEqual(["zeta.workbenchThing"]);
        }
    });

    it("a whitespace-only query behaves as empty", () => {
        const filtered = filterKeybindingItems(items, "   ");

        expect(filtered).toHaveLength(items.length);
        expect(filtered.every((entry) => entry.titleMatch === null)).toBe(true);
    });

    it("an exact label match comes first, not alphabetically", () => {
        // Regression: the `Show Hover` terms also find commands whose `show` and
        // `hover` were found somewhere in the id ("Parameter Hints: Previous Signature" —
        // `editor.action.showPrevParameterHint`). In alphabetical order
        // "Show Hover" itself ended up last, and the recorder edited someone else's row.
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

    it("a label match ranks above an id-only match — even with a worse score", () => {
        const haystack = buildKeybindingItems(
            [],
            [
                // The id match both scores higher (`save` at a word start) and comes
                // earlier alphabetically: only the label bonus can overtake it.
                command("save", "Aaa Nothing"),
                // In the label `save` is matched scattered — low score.
                command("zzz.other", "Zzz Disavowed"),
            ],
        );

        expect(filterKeybindingItems(haystack, "save").map((entry) => entry.item.commandId)).toEqual([
            "zzz.other",
            "save",
        ]);
    });

    it("an id match ranks above a combination-only match", () => {
        const haystack = buildKeybindingItems(
            // The row with the F6 binding is first alphabetically — only a score
            // difference can sort it down.
            [binding({ commandId: "mmm.plain", chord: parseChord("f6") })],
            [command("mmm.plain", "Aaa Other"), command("zzz.f6thing", "Bbb Nothing")],
        );

        expect(filterKeybindingItems(haystack, "f6").map((entry) => entry.item.commandId)).toEqual([
            "zzz.f6thing",
            "mmm.plain",
        ]);
    });

    it("with equal scores the original order stays (the sort is stable)", () => {
        // Same title — same score: the order must stay as
        // buildKeybindingItems set it (title, then id), otherwise rows of the same
        // command would scatter across the list.
        const haystack = buildKeybindingItems([], [command("zzz.save", "Save File"), command("aaa.save", "Save File")]);

        expect(filterKeybindingItems(haystack, "save").map((entry) => entry.item.commandId)).toEqual([
            "aaa.save",
            "zzz.save",
        ]);
    });

    it("@source: keeps its selection, and the rest is split into terms", () => {
        const filtered = filterKeybindingItems(items, "@source:user panel reveal");
        expect(filtered.map((entry) => entry.item.commandId)).toEqual(["zeta.workbenchThing"]);
    });

    it("non-matching entries are filtered out", () => {
        expect(filterKeybindingItems(items, "zzzzzz")).toEqual([]);
    });

    it("@conflicts selects only conflicting entries; an added combination narrows to its group", () => {
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

    it("@source: selects by source, the rest of the query is fuzzy", () => {
        const user = filterKeybindingItems(items, "@source:user");
        expect(user.map((entry) => entry.item.commandId).sort()).toEqual(["custom", "zeta.workbenchThing"]);

        const extension = filterKeybindingItems(items, "@source:extension hover");
        expect(extension.map((entry) => entry.item.commandId)).toEqual(["hover"]);

        // The source filter drops rows without a binding (source null).
        expect(filterKeybindingItems(items, "@source:default open")).toEqual([]);
    });
});
