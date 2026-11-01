import { describe, expect, it, vi } from "vitest";

import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import {
    CALL_HIERARCHY_ACTIONS,
    removeCallItemAction,
    showCallHierarchyAction,
    showIncomingCallsAction,
    showOutgoingCallsAction,
} from "./callHierarchyActions.ts";
import { HIERARCHY_VIEW_ID } from "./hierarchyComponent.ts";

function accessor() {
    const component = { show: vi.fn(), setDirection: vi.fn(), dismiss: vi.fn() };
    return { component, accessor: { get: () => component } as unknown as ServiceAccessor };
}

function titleMenu(action: typeof showOutgoingCallsAction) {
    const menu = action.menus?.at(0);
    if (menu === undefined) throw new Error("no menu");
    return menu;
}

describe("call hierarchy actions", () => {
    it("ids and titles are upstream's", () => {
        expect(CALL_HIERARCHY_ACTIONS.map(({ id, title }) => [id, title])).toEqual([
            ["references-view.showCallHierarchy", "Show Call Hierarchy"],
            ["references-view.showOutgoingCalls", "Show Outgoing Calls"],
            ["references-view.showIncomingCalls", "Show Incoming Calls"],
            ["references-view.removeCallItem", "Dismiss"],
        ]);
    });

    it("Shift+Alt+H needs a provider and a terminal that delivers it; the menu item needs a provider", () => {
        expect(showCallHierarchyAction.keybindings).toEqual([
            {
                keys: parseKeybinding("shift+alt+h"),
                when: "textInputFocus && editorHasCallHierarchyProvider && tier != 'legacy'",
            },
        ]);
        expect(showCallHierarchyAction.menus).toEqual([
            { menuId: MenuId.EditorContext, group: "navigation", order: 1.46, when: "editorHasCallHierarchyProvider" },
        ]);
    });

    it("the direction pair shares a title slot and shows one button by the current mode", () => {
        const keys = new ContextKeyService();
        keys.set("callHierarchyVisible", true);
        const outgoing = titleMenu(showOutgoingCallsAction);
        const incoming = titleMenu(showIncomingCallsAction);
        expect(outgoing.order).toBe(incoming.order);

        keys.set("callHierarchyMode", "incoming");
        expect(keys.evaluate(outgoing.when!)).toBe(true);
        expect(keys.evaluate(incoming.when!)).toBe(false);
        keys.set("callHierarchyMode", "outgoing");
        expect(keys.evaluate(outgoing.when!)).toBe(false);
        expect(keys.evaluate(incoming.when!)).toBe(true);
    });

    it("title buttons belong to the hierarchy section only", () => {
        for (const action of [showOutgoingCallsAction, showIncomingCallsAction, removeCallItemAction]) {
            const visible = titleMenu(action).visible;
            expect(visible?.({ view: HIERARCHY_VIEW_ID })).toBe(true);
            expect(visible?.({ view: "references-view.tree" })).toBe(false);
            expect(action.when).toBe("callHierarchyVisible");
        }
    });

    it("no button stays over a type tree in the shared section", () => {
        const keys = new ContextKeyService();
        keys.set("callHierarchyVisible", false);
        keys.set("callHierarchyMode", "incoming");
        expect(keys.evaluate(titleMenu(showOutgoingCallsAction).when!)).toBe(false);
        keys.set("callHierarchyMode", "outgoing");
        expect(keys.evaluate(titleMenu(showIncomingCallsAction).when!)).toBe(false);
        expect(keys.evaluate(titleMenu(removeCallItemAction).when!)).toBe(false);
        keys.set("callHierarchyVisible", true);
        expect(keys.evaluate(titleMenu(removeCallItemAction).when!)).toBe(true);
    });

    it("commands drive the component", async () => {
        const { component, accessor: services } = accessor();
        await showCallHierarchyAction.run(services);
        expect(component.show).toHaveBeenCalledOnce();
        await showOutgoingCallsAction.run(services);
        expect(component.setDirection).toHaveBeenLastCalledWith("outgoing");
        await showIncomingCallsAction.run(services);
        expect(component.setDirection).toHaveBeenLastCalledWith("incoming");
        await removeCallItemAction.run(services);
        expect(component.dismiss).toHaveBeenCalledOnce();
    });
});
