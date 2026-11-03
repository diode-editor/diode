import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../keybinding/common/keybindingRegistry.ts";

import type { IMenuContribution } from "./iMenuContribution.ts";
import { MenuId } from "./menuId.ts";
import { MenuRegistry } from "./menuRegistry.ts";

function setup(items: IMenuContribution[]): { registry: MenuRegistry; contextKeys: ContextKeyService } {
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    for (const command of new Set(items.map((i) => i.command))) commands.register(command, () => undefined, command);
    return { registry: new MenuRegistry(commands, new KeybindingRegistry(), contextKeys, items), contextKeys };
}

function labels(entries: MenuEntry[]): string[] {
    return entries.map((e) => (e.type === "separator" ? "─" : e.label));
}

describe("MenuRegistry — the unnamed group is the last section", () => {
    it('`group: ""` and a missing group share one last section', () => {
        const { registry } = setup([
            { menuId: MenuId.EditorContext, command: "empty", group: "" },
            { menuId: MenuId.EditorContext, command: "z", group: "z_commands" },
            { menuId: MenuId.EditorContext, command: "none" },
            { menuId: MenuId.EditorContext, command: "nav", group: "navigation" },
        ]);
        expect(labels(registry.getMenuItems(MenuId.EditorContext))).toEqual(["nav", "─", "z", "─", "empty", "none"]);
    });

    it("within the unnamed group: by order, ties by registration", () => {
        const { registry } = setup([
            { menuId: MenuId.EditorContext, command: "late", order: 5 },
            { menuId: MenuId.EditorContext, command: "g", group: "1_g" },
            { menuId: MenuId.EditorContext, command: "b" },
            { menuId: MenuId.EditorContext, command: "a" },
            { menuId: MenuId.EditorContext, command: "early", order: -1 },
        ]);
        expect(labels(registry.getMenuItems(MenuId.EditorContext))).toEqual(["g", "─", "early", "b", "a", "late"]);
    });

    it("only unnamed items: no separators", () => {
        const { registry } = setup([
            { menuId: MenuId.EditorContext, command: "two", order: 2 },
            { menuId: MenuId.EditorContext, command: "one", order: 1 },
        ]);
        expect(labels(registry.getMenuItems(MenuId.EditorContext))).toEqual(["one", "two"]);
    });

    it("hidden named groups leave no leading separator; a hidden unnamed group leaves no trailing one", () => {
        const { registry, contextKeys } = setup([
            { menuId: MenuId.EditorContext, command: "named", group: "1_g", when: "showNamed" },
            { menuId: MenuId.EditorContext, command: "unnamed", when: "showUnnamed" },
        ]);
        contextKeys.set("showUnnamed", true);
        expect(labels(registry.getMenuItems(MenuId.EditorContext))).toEqual(["unnamed"]);
        contextKeys.set("showUnnamed", false);
        contextKeys.set("showNamed", true);
        expect(labels(registry.getMenuItems(MenuId.EditorContext))).toEqual(["named"]);
        contextKeys.set("showUnnamed", true);
        expect(labels(registry.getMenuItems(MenuId.EditorContext))).toEqual(["named", "─", "unnamed"]);
    });

    it("the unnamed group is last also against group names that sort after letters", () => {
        const { registry } = setup([
            { menuId: MenuId.EditorContext, command: "u" },
            { menuId: MenuId.EditorContext, command: "tilde", group: "~last" },
            { menuId: MenuId.EditorContext, command: "zz", group: "zz" },
        ]);
        expect(registry.getMenuItemGroups(MenuId.EditorContext).map((g) => g.group)).toEqual(["zz", "~last", ""]);
    });
});
