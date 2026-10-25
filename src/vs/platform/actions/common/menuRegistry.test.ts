import type { MenuEntry, MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";
import { KeybindingRegistry, parseKeybinding } from "../../keybinding/common/keybindingRegistry.ts";

import type { IMenuContribution } from "./iMenuContribution.ts";
import { MenuId } from "./menuId.ts";
import type { IResolvedMenuItemEntry } from "./menuRegistry.ts";
import { MenuRegistry } from "./menuRegistry.ts";

interface Harness {
    registry: MenuRegistry;
    commands: CommandRegistry;
    keybindings: KeybindingRegistry;
    contextKeys: ContextKeyService;
    executed: { id: string; args: unknown[] }[];
}

function setup(items: IMenuContribution[]): Harness {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    const executed: { id: string; args: unknown[] }[] = [];
    const seen = new Set<string>();
    for (const item of items) {
        if (seen.has(item.command)) continue;
        seen.add(item.command);
        commands.register(
            item.command,
            (...args) => executed.push({ id: item.command, args }),
            `Title:${item.command}`,
        );
    }
    const registry = new MenuRegistry(commands, keybindings, contextKeys, items);
    return { registry, commands, keybindings, contextKeys, executed };
}

function labels(entries: MenuEntry[]): string[] {
    return entries.map((e) => (e.type === "separator" ? "─" : e.label));
}

function items(entries: MenuEntry[]): MenuItemEntry[] {
    return entries.filter((e): e is MenuItemEntry => e.type !== "separator");
}

describe("MenuRegistry", () => {
    it("returns only items of the requested menu", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "a" },
            { menuId: MenuId.ExplorerContext, command: "b" },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:a"]);
        expect(labels(h.registry.getMenuItems(MenuId.ExplorerContext))).toEqual(["Title:b"]);
    });

    it("empty menu gives []", () => {
        const h = setup([{ menuId: MenuId.ExplorerContext, command: "b" }]);
        expect(h.registry.getMenuItems(MenuId.EditorContext)).toEqual([]);
    });

    it("when: hides the item when the condition fails, shows it when it passes", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "always" },
            { menuId: MenuId.EditorContext, command: "gated", when: "textInputFocus" },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:always"]);
        h.contextKeys.set("textInputFocus", true);
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:always", "Title:gated"]);
    });

    it("visible: the predicate receives the context and filters the item", () => {
        const seenContexts: unknown[] = [];
        const h = setup([
            {
                menuId: MenuId.ExplorerContext,
                command: "paste",
                visible: (ctx) => {
                    seenContexts.push(ctx);
                    return (ctx as { canPaste: boolean }).canPaste;
                },
            },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.ExplorerContext, { canPaste: false }))).toEqual([]);
        expect(labels(h.registry.getMenuItems(MenuId.ExplorerContext, { canPaste: true }))).toEqual(["Title:paste"]);
        expect(seenContexts).toEqual([{ canPaste: false }, { canPaste: true }]);
    });

    it("sorts groups by key and inserts a separator between non-empty groups", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "z", group: "2_second" },
            { menuId: MenuId.EditorContext, command: "a", group: "1_first" },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:a", "─", "Title:z"]);
    });

    it("sorts within a group by order, ties stay in insertion order", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "third", group: "g", order: 30 },
            { menuId: MenuId.EditorContext, command: "first", group: "g", order: 10 },
            { menuId: MenuId.EditorContext, command: "second-a", group: "g", order: 20 },
            { menuId: MenuId.EditorContext, command: "second-b", group: "g", order: 20 },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual([
            "Title:first",
            "Title:second-a",
            "Title:second-b",
            "Title:third",
        ]);
    });

    it("the navigation group is always first regardless of string order", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "first", group: "1_first" },
            { menuId: MenuId.EditorContext, command: "nav", group: "navigation" },
            { menuId: MenuId.EditorContext, command: "second", group: "2_second" },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual([
            "Title:nav",
            "─",
            "Title:first",
            "─",
            "Title:second",
        ]);

        // And symmetrically: when navigation is inserted first, the other groups
        // still go after it (navigation on the right-hand side of the comparison).
        const first = setup([
            { menuId: MenuId.EditorContext, command: "nav", group: "navigation" },
            { menuId: MenuId.EditorContext, command: "other", group: "1_other" },
        ]);
        expect(labels(first.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:nav", "─", "Title:other"]);
    });

    it("defaults: no group ('') and no order (0)", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "grouped", group: "1_g" },
            { menuId: MenuId.EditorContext, command: "ungrouped-b" },
            { menuId: MenuId.EditorContext, command: "ungrouped-a" },
        ]);
        // "" sorts before "1_g"; within "" the insertion order is stable (order defaults to 0).
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual([
            "Title:ungrouped-b",
            "Title:ungrouped-a",
            "─",
            "Title:grouped",
        ]);
    });

    it("a hidden item collapses the group without an extra separator", () => {
        const h = setup([
            { menuId: MenuId.ExplorerContext, command: "copy", group: "1_clip" },
            { menuId: MenuId.ExplorerContext, command: "paste", group: "1_clip", visible: () => false },
            { menuId: MenuId.ExplorerContext, command: "rename", group: "2_mod" },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.ExplorerContext))).toEqual(["Title:copy", "─", "Title:rename"]);
    });

    it("label: explicit title, then command title, then command id", () => {
        const commands = new CommandRegistry();
        commands.register("withTitle", () => {}, "Command Title");
        commands.register("noTitle", () => {});
        const registry = new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), [
            { menuId: MenuId.EditorContext, command: "withTitle", title: "Explicit" },
            { menuId: MenuId.EditorContext, command: "withTitle" },
            { menuId: MenuId.EditorContext, command: "noTitle" },
        ]);
        expect(labels(registry.getMenuItems(MenuId.EditorContext))).toEqual(["Explicit", "Command Title", "noTitle"]);
    });

    it("shortcut: resolved from keybindings / miss / literal / suppressed by false", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "bound" },
            { menuId: MenuId.EditorContext, command: "unbound" },
            { menuId: MenuId.EditorContext, command: "literal", shortcut: "F2" },
            { menuId: MenuId.EditorContext, command: "suppressed", shortcut: false },
        ]);
        h.keybindings.register(parseKeybinding("ctrl+c"), "bound");
        h.keybindings.register(parseKeybinding("delete"), "suppressed");
        const entries = items(h.registry.getMenuItems(MenuId.EditorContext));
        expect(entries.map((e) => e.shortcut)).toEqual(["Ctrl+C", undefined, "F2", undefined]);
    });

    it("shortcut on Mac (isMac) uses glyphs, by the effective rung", () => {
        const h = setup([{ menuId: MenuId.EditorContext, command: "bound" }]);
        h.keybindings.register(parseKeybinding("mod+shift+p"), "bound");
        h.contextKeys.set("isMac", true);
        h.contextKeys.set("macKeys", 3);
        expect(items(h.registry.getMenuItems(MenuId.EditorContext)).map((e) => e.shortcut)).toEqual(["⇧⌘P"]);
        h.contextKeys.set("macKeys", 1); // mac-legacy: Cmd does not get through, so the Ctrl variant is shown
        expect(items(h.registry.getMenuItems(MenuId.EditorContext)).map((e) => e.shortcut)).toEqual(["⌃⇧P"]);
    });

    it("args resolve eagerly (even without selecting the item) and are passed to execute", () => {
        let called = 0;
        const h = setup([
            {
                menuId: MenuId.ExplorerContext,
                command: "rename",
                args: (ctx) => {
                    called++;
                    return [(ctx as { path: string }).path];
                },
            },
        ]);
        const entries = items(h.registry.getMenuItems(MenuId.ExplorerContext, { path: "/ws/a.txt" }));
        expect(called).toBe(1);
        entries[0].onSelect?.();
        expect(h.executed).toEqual([{ id: "rename", args: ["/ws/a.txt"] }]);
    });

    it("onSelect without args runs the command without arguments", () => {
        const h = setup([{ menuId: MenuId.EditorContext, command: "copy" }]);
        items(h.registry.getMenuItems(MenuId.EditorContext))[0].onSelect?.();
        expect(h.executed).toEqual([{ id: "copy", args: [] }]);
    });

    it("icon is passed through to MenuEntry", () => {
        const h = setup([{ menuId: MenuId.EditorContext, command: "a", icon: "★" }]);
        expect(items(h.registry.getMenuItems(MenuId.EditorContext))[0].icon).toBe("★");
    });

    it("appendMenuItem adds an item, dispose removes it (a repeated dispose is safe)", () => {
        const h = setup([{ menuId: MenuId.EditorContext, command: "base" }]);
        h.commands.register("added", () => {}, "Added");
        const handle = h.registry.appendMenuItem({ menuId: MenuId.EditorContext, command: "added" });
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:base", "Added"]);
        handle.dispose();
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:base"]);
        handle.dispose(); // idempotent: the item is already removed
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:base"]);
    });

    it("getSubmenus: filters by point and when, sorts by order, mnemonic", () => {
        const h = setup([]);
        const registry = new MenuRegistry(h.commands, h.keybindings, h.contextKeys, [
            {
                menuId: MenuId.MenubarMainMenu,
                submenu: MenuId.MenubarEditMenu,
                title: "Edit",
                mnemonic: "e",
                order: 20,
            },
            {
                menuId: MenuId.MenubarMainMenu,
                submenu: MenuId.MenubarFileMenu,
                title: "File",
                mnemonic: "f",
                order: 10,
            },
            // Another menu and a failing when are excluded from the result.
            { menuId: MenuId.EditorContext, submenu: MenuId.MenubarHelpMenu, title: "Elsewhere" },
            { menuId: MenuId.MenubarMainMenu, submenu: MenuId.MenubarViewMenu, title: "Focused", when: "listFocus" },
            // A plain command item in the same menu is not a submenu and is filtered out.
            { menuId: MenuId.MenubarMainMenu, command: "not-a-submenu" },
        ]);
        expect(registry.getSubmenus(MenuId.MenubarMainMenu)).toEqual([
            { title: "File", mnemonic: "f", submenu: MenuId.MenubarFileMenu },
            { title: "Edit", mnemonic: "e", submenu: MenuId.MenubarEditMenu },
        ]);
    });

    it("getMenuItems ignores submenu entries (nested popups are not rendered)", () => {
        const h = setup([{ menuId: MenuId.EditorContext, command: "cmd" }]);
        h.registry.appendMenuItem({ menuId: MenuId.EditorContext, submenu: MenuId.MenubarFileMenu, title: "Sub" });
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:cmd"]);
    });

    it("a submenu with a resolver is filtered by when and the imperative visible", () => {
        const h = setup([{ menuId: MenuId.ViewTitle, command: "cmd" }]);
        h.contextKeys.set("listFocus", false);
        h.registry.appendMenuItem({
            menuId: MenuId.ViewTitle,
            submenu: MenuId.MenubarFileMenu,
            title: "OnlyChanges",
            visible: (context) => (context as { view?: string } | undefined)?.view === "changes",
        });
        h.registry.appendMenuItem({
            menuId: MenuId.ViewTitle,
            submenu: MenuId.MenubarEditMenu,
            title: "WhenGated",
            when: "listFocus",
        });
        const resolver = (entry: { title: string }) => ({
            type: "submenu" as const,
            label: entry.title,
            entries: [],
        });

        // Another section's context: the submenu with visible is hidden; the when gate is false too.
        let titles = h.registry
            .getMenuItems(MenuId.ViewTitle, { view: "graph" }, resolver as never)
            .map((e) => ("label" in e ? e.label : "—"));
        expect(titles).toEqual(["Title:cmd"]);

        h.contextKeys.set("listFocus", true);
        titles = h.registry
            .getMenuItems(MenuId.ViewTitle, { view: "changes" }, resolver as never)
            .map((e) => ("label" in e ? e.label : "—"));
        expect(titles).toContain("OnlyChanges");
        expect(titles).toContain("WhenGated");
    });

    it("onDidChangeMenu: fires on append and on removal, but not on a repeated dispose", () => {
        const h = setup([]);
        const changed: string[] = [];
        h.registry.onDidChangeMenu((menuId) => changed.push(menuId.id));

        const handle = h.registry.appendMenuItem({ menuId: MenuId.EditorContext, command: "x" });
        expect(changed).toEqual(["EditorContext"]);

        handle.dispose();
        expect(changed).toEqual(["EditorContext", "EditorContext"]);

        handle.dispose(); // item already removed: no event
        expect(changed).toEqual(["EditorContext", "EditorContext"]);
    });

    it("onDidChangeMenu: disposing the subscription stops notifications", () => {
        const h = setup([]);
        const changed: string[] = [];
        const subscription = h.registry.onDidChangeMenu((menuId) => changed.push(menuId.id));
        subscription.dispose();

        h.registry.appendMenuItem({ menuId: MenuId.ExplorerContext, command: "y" });
        expect(changed).toEqual([]);
    });
});

describe("MenuRegistry — getMenuContexts", () => {
    it("collects the keys of the menu's when, enablement and toggled; other menus and junk add nothing", () => {
        const { registry } = setup([
            { menuId: MenuId.ViewItemContext, command: "a", when: "view == x && viewItem =~ /env/" },
            { menuId: MenuId.ViewItemContext, command: "b", enablement: "!busy", toggled: "config.on" },
            { menuId: MenuId.ViewItemContext, command: "c", when: "&& broken" },
            { menuId: MenuId.ViewItemContext, command: "d" },
            { menuId: MenuId.ViewTitle, command: "e", when: "other" },
        ]);
        registry.appendMenuItem({
            menuId: MenuId.ViewItemContext,
            submenu: MenuId.EditorContext,
            title: "More",
            when: "sub",
        });
        expect([...registry.getMenuContexts(MenuId.ViewItemContext)].sort()).toEqual([
            "busy",
            "config.on",
            "sub",
            "view",
            "viewItem",
        ]);
        expect([...registry.getMenuContexts(MenuId.EditorContext)]).toEqual([]);
    });
});

describe("MenuRegistry — enablement", () => {
    const item = (extra: Partial<IMenuContribution> = {}): IMenuContribution => ({
        menuId: MenuId.ExplorerContext,
        command: "git.commit",
        ...extra,
    });

    function entryOf(h: Harness): IResolvedMenuItemEntry {
        const entries = h.registry.getMenuItemGroups(MenuId.ExplorerContext);
        return entries[0].entries[0] as IResolvedMenuItemEntry;
    }

    it("without enablement the item is enabled", () => {
        expect(entryOf(setup([item()])).enabled).toBe(true);
        expect(entryOf(setup([item()])).disabled).toBe(false);
    });

    it("false enablement disables the item but does NOT hide it", () => {
        const h = setup([item({ enablement: "!gitOperationInProgress" })]);
        h.contextKeys.set("gitOperationInProgress", true);

        const entries = h.registry.getMenuItems(MenuId.ExplorerContext);
        // Unlike `when`, the item stays in the list: it is disabled, not removed.
        expect(entries).toHaveLength(1);
        expect(entryOf(h).enabled).toBe(false);
        expect(entryOf(h).disabled).toBe(true);
    });

    it("a disabled item does not run the command", () => {
        const h = setup([item({ enablement: "!gitOperationInProgress" })]);
        h.contextKeys.set("gitOperationInProgress", true);
        entryOf(h).onSelect?.();
        expect(h.executed).toEqual([]);

        h.contextKeys.set("gitOperationInProgress", false);
        entryOf(h).onSelect?.();
        expect(h.executed).toHaveLength(1);
    });

    it("the ⋯ button visibility ignores enablement", () => {
        const h = setup([item({ enablement: "!gitOperationInProgress" })]);
        h.contextKeys.set("gitOperationInProgress", true);
        expect(h.registry.hasItems(MenuId.ExplorerContext)).toBe(true);
    });
});

// Upstream's view pane binds `view = <id>` in its scoped context key service: an extension's
// `view/title` item says `when: view == <id>`, and several sections are on screen at once.
describe("MenuRegistry — owner context keys", () => {
    it("`when`, `enablement` and `toggled` see the owner's keys on top of the global ones", () => {
        const h = setup([
            { menuId: MenuId.ViewTitle, command: "mine", when: "view == ext.a", enablement: "view == ext.a" },
            { menuId: MenuId.ViewTitle, command: "toggle", toggled: "view == ext.a" },
            { menuId: MenuId.ViewTitle, command: "other", when: "view == ext.b" },
        ]);
        const resolved = items(h.registry.getMenuItems(MenuId.ViewTitle, undefined, undefined, { view: "ext.a" }));
        expect(resolved.map((entry) => entry.label)).toEqual(["Title:mine", "Title:toggle"]);
        expect((resolved[0] as IResolvedMenuItemEntry).enabled).toBe(true);
        expect(resolved[1].icon).not.toBeUndefined();
        expect(h.contextKeys.get("view")).toBeUndefined();
        const global = items(h.registry.getMenuItems(MenuId.ViewTitle));
        expect(global.map((entry) => entry.label)).toEqual(["Title:toggle"]);
        expect(global[0].icon).toBeUndefined();
    });
});
