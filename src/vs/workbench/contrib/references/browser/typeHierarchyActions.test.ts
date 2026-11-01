import { describe, expect, it, vi } from "vitest";

import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";

import { showCallHierarchyAction } from "./callHierarchyActions.ts";
import { HIERARCHY_VIEW_ID } from "./hierarchyComponent.ts";
import {
    removeTypeItemAction,
    showSubtypesAction,
    showSupertypesAction,
    showTypeHierarchyAction,
    TYPE_HIERARCHY_ACTIONS,
} from "./typeHierarchyActions.ts";

function titleMenu(action: CommandAction) {
    const menu = action.menus?.at(0);
    if (menu === undefined) throw new Error("no menu");
    return menu;
}

describe("type hierarchy actions", () => {
    it("ids and titles are upstream's", () => {
        expect(TYPE_HIERARCHY_ACTIONS.map(({ id, title }) => [id, title])).toEqual([
            ["references-view.showTypeHierarchy", "Show Type Hierarchy"],
            ["references-view.showSupertypes", "Show Supertypes"],
            ["references-view.showSubtypes", "Show Subtypes"],
            ["references-view.removeTypeItem", "Dismiss"],
        ]);
    });

    it("Show Type Hierarchy has no key, needs a provider and follows Show Call Hierarchy in the context menu", () => {
        expect(showTypeHierarchyAction.keybindings).toBeUndefined();
        expect(showTypeHierarchyAction.when).toBe("editorHasTypeHierarchyProvider");
        const menu = titleMenu(showTypeHierarchyAction);
        expect(menu).toEqual({
            menuId: MenuId.EditorContext,
            group: "navigation",
            order: 1.47,
            when: "editorHasTypeHierarchyProvider",
        });
        const calls = titleMenu(showCallHierarchyAction);
        expect(menu.group).toBe(calls.group);
        expect(menu.order).toBeGreaterThan(calls.order ?? Infinity);
    });

    it("the direction pair shares a title slot, with upstream's icons, and shows one button by the mode", () => {
        const keys = new ContextKeyService();
        keys.set("typeHierarchyVisible", true);
        const supertypes = titleMenu(showSupertypesAction);
        const subtypes = titleMenu(showSubtypesAction);
        expect(supertypes.order).toBe(subtypes.order);
        expect(supertypes.icon).toEqual(codicon("type-hierarchy-super"));
        expect(subtypes.icon).toEqual(codicon("type-hierarchy-sub"));

        keys.set("typeHierarchyMode", "subtypes");
        expect(keys.evaluate(supertypes.when!)).toBe(true);
        expect(keys.evaluate(subtypes.when!)).toBe(false);
        keys.set("typeHierarchyMode", "supertypes");
        expect(keys.evaluate(supertypes.when!)).toBe(false);
        expect(keys.evaluate(subtypes.when!)).toBe(true);
    });

    it("no button stays over a call tree in the shared section", () => {
        const keys = new ContextKeyService();
        keys.set("typeHierarchyVisible", false);
        keys.set("typeHierarchyMode", "subtypes");
        expect(keys.evaluate(titleMenu(showSupertypesAction).when!)).toBe(false);
        keys.set("typeHierarchyMode", "supertypes");
        expect(keys.evaluate(titleMenu(showSubtypesAction).when!)).toBe(false);
        expect(keys.evaluate(titleMenu(removeTypeItemAction).when!)).toBe(false);
        keys.set("typeHierarchyVisible", true);
        expect(keys.evaluate(titleMenu(removeTypeItemAction).when!)).toBe(true);
    });

    it("title buttons belong to the hierarchy section only", () => {
        for (const action of [showSupertypesAction, showSubtypesAction, removeTypeItemAction]) {
            const visible = titleMenu(action).visible;
            expect(visible?.({ view: HIERARCHY_VIEW_ID })).toBe(true);
            expect(visible?.({ view: "references-view.tree" })).toBe(false);
            expect(action.when).toBe("typeHierarchyVisible");
        }
        expect(titleMenu(removeTypeItemAction).icon).toEqual(codicon("close"));
    });

    it("commands drive the component", async () => {
        const component = { show: vi.fn(), setDirection: vi.fn(), dismiss: vi.fn() };
        const services = { get: () => component } as unknown as ServiceAccessor;
        await showTypeHierarchyAction.run(services);
        expect(component.show).toHaveBeenCalledOnce();
        await showSupertypesAction.run(services);
        expect(component.setDirection).toHaveBeenLastCalledWith("supertypes");
        await showSubtypesAction.run(services);
        expect(component.setDirection).toHaveBeenLastCalledWith("subtypes");
        await removeTypeItemAction.run(services);
        expect(component.dismiss).toHaveBeenCalledOnce();
    });
});
