import { describe, expect, it } from "vitest";

import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { ViewContainerMenuContext } from "../../../browser/actions/menuContexts.ts";
import { VIEWLET_ID } from "../common/debug.ts";

import { FOCUS_SESSION_ID, SELECT_DEBUG_SESSION_ID } from "./debugCommands.ts";
import { DockedDebugToolbarItems } from "./debugToolbar.ts";

describe("DockedDebugToolbarItems", () => {
    function setup(): {
        menus: MenuRegistry;
        contextKeys: ContextKeyService;
        inTitle: (container: string) => string[];
    } {
        const contextKeys = new ContextKeyService();
        const menus = new MenuRegistry(new CommandRegistry(), new KeybindingRegistry(), contextKeys, [
            { menuId: MenuId.DebugToolBar, command: "builtin.stop", title: "Stop", group: "navigation", order: 70 },
        ]);
        const inTitle = (container: string): string[] => {
            const context: ViewContainerMenuContext = { container };
            return menus
                .getMenuItems(MenuId.ViewContainerTitle, context)
                .map((entry) => (entry.type === "separator" ? "-" : entry.label));
        };
        return { menus, contextKeys, inTitle };
    }

    it("every toolbar item, one added later too, is in the Run and Debug title while docked and debugging", () => {
        const { menus, contextKeys, inTitle } = setup();
        const docked = new DockedDebugToolbarItems(menus);
        const ping = menus.appendMenuItem({
            menuId: MenuId.DebugToolBar,
            command: "ext.ping",
            title: "Ping",
            group: "navigation",
            order: 80,
            when: "debugType == 'demo'",
        });

        contextKeys.set("debugState", "stopped");
        contextKeys.set("debugType", "demo");
        expect(inTitle(VIEWLET_ID)).toEqual([]);
        contextKeys.setRaw("config.debug.toolBarLocation", "docked");
        expect(inTitle(VIEWLET_ID)).toEqual(["Stop", "Ping"]);
        expect(inTitle("workbench.view.explorer")).toEqual([]);
        // The item's own `when` still holds in the title.
        contextKeys.set("debugType", "cppdbg");
        expect(inTitle(VIEWLET_ID)).toEqual(["Stop"]);
        contextKeys.set("debugState", "inactive");
        expect(inTitle(VIEWLET_ID)).toEqual([]);

        contextKeys.set("debugState", "stopped");
        contextKeys.set("debugType", "demo");
        ping.dispose();
        expect(inTitle(VIEWLET_ID)).toEqual(["Stop"]);
        docked.dispose();
        expect(inTitle(VIEWLET_ID)).toEqual([]);
    });

    it("the twin of Focus Session opens Select Debug Session: the title has no select of the sessions", () => {
        const { menus } = setup();
        menus.appendMenuItem({
            menuId: MenuId.DebugToolBar,
            command: FOCUS_SESSION_ID,
            title: "Focus Session",
            group: "navigation",
            order: 100,
        });
        new DockedDebugToolbarItems(menus);

        const twins = menus
            .getContributions(MenuId.ViewContainerTitle)
            .map((item) => ("command" in item ? item.command : ""));
        expect(twins).toEqual(["builtin.stop", SELECT_DEBUG_SESSION_ID]);
    });
});
