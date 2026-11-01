import { describe, expect, it } from "vitest";

import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { CommandsQuickAccessProvider } from "../../quickaccess/browser/commandsQuickAccessProvider.ts";

import { CALL_HIERARCHY_ACTIONS } from "./callHierarchyActions.ts";
import { TYPE_HIERARCHY_ACTIONS } from "./typeHierarchyActions.ts";

function paletteLabels(query: string): string[] {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    const menus = new MenuRegistry(commands, keybindings, contextKeys, []);
    for (const action of [...CALL_HIERARCHY_ACTIONS, ...TYPE_HIERARCHY_ACTIONS]) {
        commands.register(action.id, () => undefined, action.title);
        for (const menu of action.menus ?? []) menus.appendMenuItem({ ...menu, command: action.id });
    }
    const editors = { getActiveEditor: () => null };
    return new CommandsQuickAccessProvider(commands, keybindings, contextKeys, menus, editors)
        .getItems(`>${query}`)
        .map((item) => item.label);
}

describe("hierarchy commands in the command palette", () => {
    // Upstream: `commandPalette: [{ command: "references-view.removeTypeItem", when: "never" }]`, the same for
    // removeCallItem. Otherwise the palette lists two identical "Dismiss" rows, and the wrong one silently does nothing.
    it("Dismiss is not listed", () => {
        expect(paletteLabels("Dismiss")).toEqual([]);
    });

    it("Show Type Hierarchy is listed", () => {
        expect(paletteLabels("Show Type Hierarchy")).toEqual(["Show Type Hierarchy"]);
    });
});
