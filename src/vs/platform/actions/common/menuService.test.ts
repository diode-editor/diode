import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it } from "vitest";

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../TestUtils/disposableLeaks.ts";
import { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../keybinding/common/keybindingRegistry.ts";

import type { MenuContribution } from "./iMenuContribution.ts";
import { MenuId } from "./menuId.ts";
import { joinMenuGroups, MenuRegistry } from "./menuRegistry.ts";
import { MenuService } from "./menuService.ts";

const disposables = ensureNoDisposablesAreLeakedInTestSuite();

function setup(items: MenuContribution[] = []): { registry: MenuRegistry; service: MenuService } {
    const registry = new MenuRegistry(new CommandRegistry(), new KeybindingRegistry(), new ContextKeyService(), items);
    return { registry, service: new MenuService(registry) };
}

describe("MenuService — live menus (IMenu)", () => {
    it("getEntries resolves its own point's items through the registry (with context)", () => {
        const seen: unknown[] = [];
        const { service } = setup([
            {
                menuId: MenuId.ExplorerContext,
                command: "cmd",
                title: "Cmd",
                visible: (ctx) => {
                    seen.push(ctx);
                    return true;
                },
            },
        ]);
        const menu = disposables.add(service.createMenu(MenuId.ExplorerContext));
        const entries = menu.getEntries({ path: "/x" });
        expect(entries.map((e) => (e.type === "separator" ? "─" : e.label))).toEqual(["Cmd"]);
        expect(seen).toEqual([{ path: "/x" }]);
    });

    it("getSubmenus returns its own point's submenu entries", () => {
        const { service } = setup([
            { menuId: MenuId.MenubarMainMenu, submenu: MenuId.MenubarFileMenu, title: "File", mnemonic: "f" },
        ]);
        const menu = disposables.add(service.createMenu(MenuId.MenubarMainMenu));
        expect(menu.getSubmenus()).toEqual([{ title: "File", mnemonic: "f", submenu: MenuId.MenubarFileMenu }]);
    });

    it("onDidChange: fires for its own point and stays silent for others", () => {
        const { registry, service } = setup();
        const menu = disposables.add(service.createMenu(MenuId.EditorContext));
        let fired = 0;
        disposables.add(menu.onDidChange(() => fired++));

        registry.appendMenuItem({ menuId: MenuId.ExplorerContext, command: "other" });
        expect(fired).toBe(0);

        const handle = registry.appendMenuItem({ menuId: MenuId.EditorContext, command: "mine" });
        expect(fired).toBe(1);
        handle.dispose(); // removing an item is a change too
        expect(fired).toBe(2);
    });

    it("disposing a listener subscription stops notifications", () => {
        const { registry, service } = setup();
        const menu = disposables.add(service.createMenu(MenuId.EditorContext));
        let fired = 0;
        const subscription = disposables.add(menu.onDidChange(() => fired++));
        subscription.dispose();

        registry.appendMenuItem({ menuId: MenuId.EditorContext, command: "x" });
        expect(fired).toBe(0);
    });

    it("disposing the menu unsubscribes it from the registry", () => {
        const { registry, service } = setup();
        const menu = disposables.add(service.createMenu(MenuId.EditorContext));
        let fired = 0;
        disposables.add(menu.onDidChange(() => fired++));
        menu.dispose();

        registry.appendMenuItem({ menuId: MenuId.EditorContext, command: "x" });
        expect(fired).toBe(0);
    });
});

function entryLabel(entry: MenuEntry): string {
    return entry.type === "separator" ? "─" : entry.label;
}

describe("MenuService — owner context keys", () => {
    it("getEntryGroups evaluates `when` with the owner's keys, in submenus too", () => {
        const sub = new MenuId("test.ownerKeysSub");
        const { service } = setup([
            { menuId: MenuId.ViewTitle, command: "top", title: "Top", when: "view == ext.a" },
            { menuId: MenuId.ViewTitle, submenu: sub, title: "More", when: "view == ext.a" },
            { menuId: sub, command: "inner", title: "Inner", when: "view == ext.a" },
            { menuId: sub, command: "stranger", title: "Stranger", when: "view == ext.b" },
        ]);
        const groups = service.getEntryGroups(MenuId.ViewTitle, undefined, { view: "ext.a" });
        const entries = joinMenuGroups(groups);
        expect(entries.map(entryLabel)).toEqual(["Top", "More"]);
        const submenu = entries[1];
        const inner = submenu.type === "submenu" && Array.isArray(submenu.entries) ? submenu.entries : [];
        expect(inner.map(entryLabel)).toEqual(["Inner"]);
        expect(service.getEntryGroups(MenuId.ViewTitle)).toEqual([]);
    });
});
