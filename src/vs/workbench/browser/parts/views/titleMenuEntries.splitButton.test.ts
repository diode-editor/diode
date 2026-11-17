import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it } from "vitest";

import type {
    IMenuEntryGroup,
    IResolvedSplitButton,
    ResolvedMenuEntry,
} from "../../../../platform/actions/common/menuRegistry.ts";

import { inlineActions, type ISplitButtonMemory, overflowEntries, runAction } from "./titleMenuEntries.ts";

const PRIMARY = "splitButton.primary:Run";
const DROPDOWN = "splitButton.dropdown:Run";

function memory(initial?: string): ISplitButtonMemory & { stored: Map<string, string> } {
    const stored = new Map<string, string>(initial === undefined ? [] : [["Run", initial]]);
    return {
        stored,
        lastActionId: (submenu) => stored.get(submenu),
        remember: (submenu, actionId) => {
            stored.set(submenu, actionId);
        },
    };
}

function split(
    entries: MenuEntry[] | (() => MenuEntry[]),
    options: Partial<IResolvedSplitButton> = {},
    group = "navigation",
): IMenuEntryGroup[] {
    const splitButton: IResolvedSplitButton = { submenu: "Run", togglePrimaryAction: true, icon: "▷", ...options };
    const entry: ResolvedMenuEntry = { type: "submenu", label: "Run or Debug...", entries, splitButton };
    return [{ group, entries: [entry] }];
}

function command(id: string, runs: string[], extra: { icon?: string; enabled?: boolean } = {}): MenuEntry {
    const enabled = extra.enabled ?? true;
    return {
        label: id,
        id,
        enabled,
        ...(extra.icon === undefined ? {} : { icon: extra.icon }),
        onSelect: () => {
            if (enabled) runs.push(id);
        },
    } as MenuEntry;
}

function labels(entries: readonly MenuEntry[]): string[] {
    return entries.map((entry) => (entry.type === "separator" ? "─" : entry.label));
}

/** Opens the arrow and returns what the popup would show. */
function openArrow(groups: IMenuEntryGroup[], mem: ISplitButtonMemory): MenuEntry[] {
    let shown: MenuEntry[] = [];
    runAction(groups, DROPDOWN, {
        memory: mem,
        showDropdown: (entries) => {
            shown = entries;
        },
    });
    return shown;
}

describe("titleMenuEntries — split buttons", () => {
    it("a split button is a button and an attached arrow, and stays out of ⋯", () => {
        const runs: string[] = [];
        const groups = split([command("a", runs), command("b", runs)]);
        expect(inlineActions(groups)).toStrictEqual([
            { id: PRIMARY, icon: "▷", enabled: true, color: undefined },
            { id: DROPDOWN, icon: "▾", attached: true },
        ]);
        expect(overflowEntries(groups)).toStrictEqual([]);
    });

    it("the primary item's own icon and color win over the submenu's; its enablement dims the button", () => {
        const runs: string[] = [];
        const primary = {
            ...command("a", runs, { icon: "★", enabled: false }),
            iconColor: "debugIcon.startForeground",
        };
        const groups = split([primary as MenuEntry, command("b", runs)]);
        expect(inlineActions(groups)[0]).toStrictEqual({
            id: PRIMARY,
            icon: "★",
            enabled: false,
            color: "debugIcon.startForeground",
        });
    });

    it("without any glyph the submenu goes to ⋯ with its label", () => {
        const runs: string[] = [];
        const groups = split([command("a", runs)], { icon: undefined });
        expect(inlineActions(groups)).toStrictEqual([]);
        expect(labels(overflowEntries(groups))).toStrictEqual(["Run or Debug..."]);
    });

    it("a submenu with no command item has nothing to run and is not a button", () => {
        const nested: MenuEntry = { type: "submenu", label: "More", entries: [] };
        const groups = split([nested]);
        expect(inlineActions(groups)).toStrictEqual([]);
        expect(labels(overflowEntries(groups))).toStrictEqual(["Run or Debug..."]);
    });

    it("outside `navigation` it is an ordinary submenu of ⋯", () => {
        const runs: string[] = [];
        const groups = split([command("a", runs)], {}, "1_run");
        expect(inlineActions(groups)).toStrictEqual([]);
        expect(labels(overflowEntries(groups))).toStrictEqual(["Run or Debug..."]);
        runAction(groups, PRIMARY);
        expect(runs).toStrictEqual([]);
    });

    it("the button runs the remembered item, the first one when nothing is remembered", () => {
        const runs: string[] = [];
        const groups = split([command("a", runs), { type: "separator" }, command("b", runs)]);
        runAction(groups, PRIMARY);
        runAction(groups, PRIMARY, { memory: memory("b"), showDropdown: () => undefined });
        runAction(groups, PRIMARY, { memory: memory("gone"), showDropdown: () => undefined });
        expect(runs).toStrictEqual(["a", "b", "a"]);
    });

    it("the arrow shows every entry; a pick runs and is remembered, nested submenus included", () => {
        const runs: string[] = [];
        const mem = memory();
        const nested: MenuEntry = { type: "submenu", label: "More", entries: () => [command("c", runs)] };
        const groups = split(() => [command("a", runs), { type: "separator" }, command("b", runs), nested]);
        const shown = openArrow(groups, mem);
        expect(labels(shown)).toStrictEqual(["a", "─", "b", "More"]);

        const pick = (entry: MenuEntry | undefined): void => {
            if (entry?.type === undefined) entry?.onSelect?.();
        };
        pick(shown[2]);
        expect(runs).toStrictEqual(["b"]);
        expect(mem.stored.get("Run")).toBe("b");

        const more = shown[3];
        if (more.type !== "submenu" || typeof more.entries === "function") throw new Error("resolved submenu expected");
        pick(more.entries[0]);
        expect(runs).toStrictEqual(["b", "c"]);
        expect(mem.stored.get("Run")).toBe("c");
    });

    it("an entry without an id runs unremembered", () => {
        const runs: string[] = [];
        const mem = memory();
        const anonymous: MenuEntry = { label: "anonymous", onSelect: () => runs.push("anonymous") };
        const shown = openArrow(split([command("a", runs), anonymous]), mem);
        const entry = shown[1];
        if (entry.type === undefined) entry.onSelect?.();
        expect(runs).toStrictEqual(["anonymous"]);
        expect(mem.stored.size).toBe(0);
    });

    it("without togglePrimaryAction the button is always the first item and picks are not remembered", () => {
        const runs: string[] = [];
        const mem = memory("b");
        const groups = split([command("a", runs), command("b", runs)], { togglePrimaryAction: false });
        runAction(groups, PRIMARY, { memory: mem, showDropdown: () => undefined });
        const shown = openArrow(groups, mem);
        const entry = shown[0];
        if (entry.type === undefined) entry.onSelect?.();
        expect(runs).toStrictEqual(["a", "a"]);
        expect(mem.stored.get("Run")).toBe("b");
    });

    it("an item without onSelect neither throws from the button nor from the arrow, and is still remembered", () => {
        const mem = memory();
        const bare: MenuEntry = { label: "bare", id: "bare", enabled: true } as MenuEntry;
        const groups = split([bare]);
        runAction(groups, PRIMARY, { memory: mem, showDropdown: () => undefined });
        const entry = openArrow(groups, mem)[0];
        if (entry.type === undefined) entry.onSelect?.();
        expect(mem.stored.get("Run")).toBe("bare");
    });

    it("an action id of no split button opens no popup and runs nothing", () => {
        const runs: string[] = [];
        const shown: MenuEntry[][] = [];
        const host = {
            memory: memory(),
            showDropdown: (entries: MenuEntry[]) => {
                shown.push(entries);
            },
        };
        const groups = split([command("a", runs)]);
        runAction(groups, "splitButton.dropdown:Other", host);
        runAction(groups, "some.command", host);
        expect(shown).toStrictEqual([]);
        expect(runs).toStrictEqual([]);
    });

    it("the arrow without a host does nothing", () => {
        const runs: string[] = [];
        runAction(split([command("a", runs)]), DROPDOWN);
        expect(runs).toStrictEqual([]);
    });
});
