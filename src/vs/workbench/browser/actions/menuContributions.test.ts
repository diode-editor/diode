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

    it("enablement наследуется от экшена, своё у размещения — сужает (AND)", () => {
        const inherited = menuItemsOfAction(
            action({ enablement: "gitHasRepo", menus: [{ menuId: MenuId.ExplorerContext }] }),
        );
        expect(inherited[0].enablement).toBe("gitHasRepo");

        const narrowed = menuItemsOfAction(
            action({
                enablement: "gitHasRepo",
                menus: [{ menuId: MenuId.ExplorerContext, enablement: "!gitOperationInProgress" }],
            }),
        );
        expect(narrowed[0].enablement).toBe("(gitHasRepo) && (!gitOperationInProgress)");

        const none = menuItemsOfAction(action({ menus: [{ menuId: MenuId.ExplorerContext }] }));
        expect(none[0].enablement).toBeUndefined();
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
            "Select for Compare",
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

    it("ExplorerContext: «Compare with Selected» появляется после Select for Compare", () => {
        const contextKeys = new ContextKeyService();
        expect(labels(MenuId.ExplorerContext, { path: "/ws/a.txt", canPaste: true }, contextKeys)).not.toContain(
            "Compare with Selected",
        );
        contextKeys.set("resourceSelectedForCompare", true);
        expect(labels(MenuId.ExplorerContext, { path: "/ws/a.txt", canPaste: true }, contextKeys)).toContain(
            "Compare with Selected",
        );
    });

    it("ExplorerContext: пустой буфер обмена прячет Paste", () => {
        expect(labels(MenuId.ExplorerContext, { path: "/ws/a.txt", canPaste: false })).not.toContain("Paste");
    });

    it("ViewTitle: пункты фильтруются по id view из menuContext", () => {
        const contextKeys = new ContextKeyService();
        contextKeys.set("scmViewletVisible", true);
        // Без репозитория git-топ (Pull/Push/Checkout/Fetch) скрыт when-гейтами;
        // Show Git Output безусловен.
        expect(labels(MenuId.ViewTitle, { view: "workbench.scm.changes" }, contextKeys)).toEqual([
            "View as Tree",
            "View as List",
            "─",
            "Show Git Output",
        ]);
        expect(labels(MenuId.ViewTitle, { view: "workbench.scm.graph" }, contextKeys)).toEqual(["Refresh"]);
        expect(labels(MenuId.ViewTitle, { view: "ghost" }, contextKeys)).toEqual([]);
    });

    it("ViewTitle CHANGES: repo-state включает git-топ (подменю — только с резолвером)", () => {
        const contextKeys = new ContextKeyService();
        contextKeys.set("scmViewletVisible", true);
        contextKeys.set("gitHasRepo", true);
        contextKeys.set("gitHasRemotes", true);
        expect(labels(MenuId.ViewTitle, { view: "workbench.scm.changes" }, contextKeys)).toEqual([
            "View as Tree",
            "View as List",
            "─",
            "Pull",
            "Push",
            "Checkout to...",
            "Fetch",
            "─",
            "Show Git Output",
        ]);
    });
});
