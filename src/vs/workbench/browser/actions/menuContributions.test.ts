import { describe, expect, it } from "vitest";

import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { MenuRegistry } from "../../../platform/actions/common/menuRegistry.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";

import { MENU_CONTRIBUTIONS, menuItemsOfAction } from "./menuContributions.ts";

function action(overrides: Partial<CommandAction>): CommandAction {
    return { id: "test.command", title: "Test: Command", run: () => undefined, ...overrides };
}

describe("menuItemsOfAction — деривация contributions из co-located размещений", () => {
    it("экшен без menus → пусто", () => {
        expect(menuItemsOfAction(action({}))).toEqual([]);
    });

    it("label: явный title размещения → shortTitle → title экшена", () => {
        const explicit = menuItemsOfAction(
            action({
                shortTitle: "Command",
                menus: [{ menuId: MenuId.EditorContext, title: "Menu-Only Label" }],
            }),
        );
        expect(explicit[0].title).toBe("Menu-Only Label");

        const short = menuItemsOfAction(action({ shortTitle: "Command", menus: [{ menuId: MenuId.EditorContext }] }));
        expect(short[0].title).toBe("Command");

        const full = menuItemsOfAction(action({ menus: [{ menuId: MenuId.EditorContext }] }));
        expect(full[0].title).toBe("Test: Command");
    });

    it("переносит command=id и поля размещения (group/order/args/shortcut)", () => {
        const args = (): readonly unknown[] => ["/x"];
        const [item] = menuItemsOfAction(
            action({
                menus: [{ menuId: MenuId.ExplorerContext, group: "4_modify", order: 20, args, shortcut: false }],
            }),
        );
        expect(item).toMatchObject({
            menuId: MenuId.ExplorerContext,
            command: "test.command",
            group: "4_modify",
            order: 20,
            args,
            shortcut: false,
        });
    });
});

describe("MENU_CONTRIBUTIONS — итоговые встроенные меню", () => {
    function registryOfBuiltins(contextKeys?: ContextKeyService): MenuRegistry {
        return new MenuRegistry(
            new CommandRegistry(),
            new KeybindingRegistry(),
            contextKeys ?? new ContextKeyService(),
            MENU_CONTRIBUTIONS,
        );
    }

    function labels(menuId: MenuId, context?: unknown, contextKeys?: ContextKeyService): (string | "─")[] {
        return registryOfBuiltins(contextKeys)
            .getMenuItems(menuId, context)
            .map((e) => (e.type === "separator" ? "─" : e.label));
    }

    it("EditorContext: клипборд + Undo", () => {
        expect(labels(MenuId.EditorContext)).toEqual(["Copy", "Cut", "Paste", "─", "Undo"]);
    });

    it("ExplorerContext: полный состав c label'ами из shortTitle", () => {
        expect(labels(MenuId.ExplorerContext, { path: "/ws/a.txt", canPaste: true })).toEqual([
            "New File...",
            "New Folder...",
            "─",
            "Copy",
            "Cut",
            "Paste",
            "─",
            "Copy Path",
            "Copy Relative Path",
            "─",
            "Rename...",
            "Delete",
            "─",
            "Refresh Explorer",
        ]);
    });

    it("ExplorerContext: пустой буфер обмена прячет Paste", () => {
        expect(labels(MenuId.ExplorerContext, { path: "/ws/a.txt", canPaste: false })).not.toContain("Paste");
    });

    it("ViewMoreActions: пункты фильтруются по id view из menuContext", () => {
        const contextKeys = new ContextKeyService();
        contextKeys.set("scmViewletVisible", true);
        expect(labels(MenuId.ViewMoreActions, { view: "workbench.scm.changes" }, contextKeys)).toEqual([
            "View as Tree",
            "View as List",
        ]);
        expect(labels(MenuId.ViewMoreActions, { view: "workbench.scm.graph" }, contextKeys)).toEqual(["Refresh"]);
        expect(labels(MenuId.ViewMoreActions, { view: "ghost" }, contextKeys)).toEqual([]);
    });
});
