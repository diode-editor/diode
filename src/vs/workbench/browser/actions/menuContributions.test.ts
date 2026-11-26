import { describe, expect, it } from "vitest";

import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { MenuRegistry } from "../../../platform/actions/common/menuRegistry.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { MENU_CONTRIBUTIONS } from "../../workbench.common.main.ts";

import { menuItemsOfAction } from "./menuContributions.ts";

function action(overrides: Partial<CommandAction>): CommandAction {
    return { id: "test.command", title: "Test: Command", run: () => undefined, ...overrides };
}

describe("menuItemsOfAction — derives contributions from co-located placements", () => {
    it("action without menus → empty", () => {
        expect(menuItemsOfAction(action({}))).toEqual([]);
    });

    it("label: explicit placement title → shortTitle → action title", () => {
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

    it("carries command=id and placement fields (group/order/args/shortcut)", () => {
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

    it("enablement is inherited from the action, the placement's own one narrows it (AND)", () => {
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

describe("MENU_CONTRIBUTIONS — resulting built-in menus", () => {
    function registryOfBuiltins(contextKeys?: ContextKeyService): MenuRegistry {
        return new MenuRegistry(
            new CommandRegistry(),
            new KeybindingRegistry(),
            contextKeys ?? new ContextKeyService(),
            MENU_CONTRIBUTIONS,
        );
    }

    function labels(menuId: MenuId, context?: unknown, contextKeys?: ContextKeyService): string[] {
        return registryOfBuiltins(contextKeys)
            .getMenuItems(menuId, context)
            .map((e) => (e.type === "separator" ? "─" : e.label));
    }

    it("EditorContext: items and order match upstream verbatim", () => {
        // Upstream groups: `1_modification` → `1_quickfix` → `9_cutcopypaste` →
        // `z_commands` (`navigation` always comes first, but its items are gated
        // by `editorHas*Provider` keys — without providers they're absent here).
        expect(labels(MenuId.EditorContext)).toEqual([
            "Change All Occurrences",
            "─",
            "Cut",
            "Copy",
            "Paste",
            "─",
            "Command Palette...",
        ]);
    });

    it("EditorContext: language feature items come with provider keys", () => {
        const contextKeys = new ContextKeyService();
        contextKeys.set("editorHasDefinitionProvider", true);
        contextKeys.set("editorHasImplementationProvider", true);
        contextKeys.set("editorHasTypeDefinitionProvider", true);
        contextKeys.set("editorHasDeclarationProvider", true);
        contextKeys.set("editorHasReferenceProvider", true);
        contextKeys.set("editorHasRenameProvider", true);
        contextKeys.set("editorHasCodeActionsProvider", true);
        contextKeys.set("editorHasDocumentFormattingProvider", true);
        contextKeys.set("editorHasDocumentSelectionFormattingProvider", true);
        contextKeys.set("editorHasSelection", true);

        expect(labels(MenuId.EditorContext, undefined, contextKeys)).toEqual([
            "Go to Definition",
            "Go to Declaration",
            "Go to Type Definition",
            "Go to Implementations",
            "Find All References",
            "─",
            "Rename Symbol",
            "Change All Occurrences",
            "Format Document",
            "Format Selection",
            "Refactor...",
            "Source Action...",
            "─",
            "Quick Fix",
            "─",
            "Cut",
            "Copy",
            "Paste",
            "─",
            "Command Palette...",
        ]);
    });

    it("ExplorerContext: full item set with labels from shortTitle", () => {
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

    it("ExplorerContext: 'Compare with Selected' appears after Select for Compare", () => {
        const contextKeys = new ContextKeyService();
        expect(labels(MenuId.ExplorerContext, { path: "/ws/a.txt", canPaste: true }, contextKeys)).not.toContain(
            "Compare with Selected",
        );
        contextKeys.set("resourceSelectedForCompare", true);
        expect(labels(MenuId.ExplorerContext, { path: "/ws/a.txt", canPaste: true }, contextKeys)).toContain(
            "Compare with Selected",
        );
    });

    it("ExplorerContext: an empty clipboard hides Paste", () => {
        expect(labels(MenuId.ExplorerContext, { path: "/ws/a.txt", canPaste: false })).not.toContain("Paste");
    });

    it("ViewTitle: items are filtered by the view id from menuContext", () => {
        const contextKeys = new ContextKeyService();
        contextKeys.set("scmViewletVisible", true);
        // Without a repository the git top (Pull/Push/Checkout/Fetch) is hidden by when gates;
        // Show Git Output is unconditional.
        expect(labels(MenuId.ViewTitle, { view: "workbench.scm.changes" }, contextKeys)).toEqual([
            "View as Tree",
            "View as List",
            "─",
            "Show Git Output",
        ]);
        expect(labels(MenuId.ViewTitle, { view: "workbench.scm.graph" }, contextKeys)).toEqual(["Refresh"]);
        expect(labels(MenuId.ViewTitle, { view: "ghost" }, contextKeys)).toEqual([]);
    });

    it("ViewTitle CHANGES: repo-state includes the git top items (submenu only with a resolver)", () => {
        const contextKeys = new ContextKeyService();
        contextKeys.set("scmViewletVisible", true);
        contextKeys.set("gitHasRepo", true);
        contextKeys.set("gitHasRemotes", true);
        expect(labels(MenuId.ViewTitle, { view: "workbench.scm.changes" }, contextKeys)).toEqual([
            "Refresh",
            "─",
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
