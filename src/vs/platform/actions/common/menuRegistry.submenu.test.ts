import type { MenuSubmenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../keybinding/common/keybindingRegistry.ts";

import type { MenuContribution } from "./iMenuContribution.ts";
import { MenuId } from "./menuId.ts";
import { MenuRegistry } from "./menuRegistry.ts";

const TEST_MENU = new MenuId("test.registry.submenu.root");
const TEST_SUB = new MenuId("test.registry.submenu.nested");

function makeRegistry(contributions: readonly MenuContribution[], contextKeys = new ContextKeyService()): MenuRegistry {
    const commands = new CommandRegistry();
    commands.register("cmd.a", () => {}, "Alpha");
    commands.register("cmd.b", () => {}, "Beta");
    return new MenuRegistry(commands, new KeybindingRegistry(), contextKeys, contributions);
}

const resolveAsEntry = (submenu: { title: string }): MenuSubmenuEntry => ({
    type: "submenu",
    label: submenu.title,
    entries: [{ label: "nested" }],
});

describe("MenuRegistry — submenu entries in getMenuItems", () => {
    it("without a resolver submenu entries are filtered out (menu bar behavior)", () => {
        const registry = makeRegistry([
            { menuId: TEST_MENU, command: "cmd.a" },
            { menuId: TEST_MENU, submenu: TEST_SUB, title: "Nested" },
        ]);

        const labels = registry.getMenuItems(TEST_MENU).map((e) => (e.type === "separator" ? "─" : e.label));
        expect(labels).toEqual(["Alpha"]);
    });

    it("with a resolver a submenu lands in its group/order slot", () => {
        const registry = makeRegistry([
            { menuId: TEST_MENU, command: "cmd.a", group: "1_a", order: 1 },
            { menuId: TEST_MENU, submenu: TEST_SUB, title: "Nested", group: "1_a", order: 2 },
            { menuId: TEST_MENU, command: "cmd.b", group: "2_b" },
        ]);

        const labels = registry
            .getMenuItems(TEST_MENU, undefined, resolveAsEntry)
            .map((e) => (e.type === "separator" ? "─" : e.label));
        expect(labels).toEqual(["Alpha", "Nested", "─", "Beta"]);
    });

    it("null from the resolver drops the item; an emptied group leaves no separator", () => {
        const registry = makeRegistry([
            { menuId: TEST_MENU, command: "cmd.a", group: "1_a" },
            { menuId: TEST_MENU, submenu: TEST_SUB, title: "Dropped", group: "2_b" },
        ]);

        const labels = registry
            .getMenuItems(TEST_MENU, undefined, () => null)
            .map((e) => (e.type === "separator" ? "─" : e.label));
        expect(labels).toEqual(["Alpha"]);
    });

    it("the when filter applies to submenu entries with a resolver too", () => {
        const contextKeys = new ContextKeyService();
        contextKeys.setRaw("showNested", false);
        const registry = makeRegistry(
            [
                { menuId: TEST_MENU, command: "cmd.a" },
                { menuId: TEST_MENU, submenu: TEST_SUB, title: "Nested", when: "showNested" },
            ],
            contextKeys,
        );

        const labels = registry
            .getMenuItems(TEST_MENU, undefined, resolveAsEntry)
            .map((e) => (e.type === "separator" ? "─" : e.label));
        expect(labels).toEqual(["Alpha"]);
    });
});

describe("MenuRegistry — submenu selection (isSelection)", () => {
    it("the selection flag reaches the resolved entry, so the view title does not duplicate the widget", () => {
        const registry = makeRegistry([
            { menuId: TEST_MENU, submenu: TEST_SUB, title: "Switch", group: "navigation", isSelection: true },
            { menuId: TEST_MENU, submenu: TEST_SUB, title: "Nested", group: "navigation", isSelection: false },
        ]);

        const [navigation] = registry.getMenuItemGroups(TEST_MENU, undefined, resolveAsEntry);
        expect(navigation.entries[0]).toEqual({
            type: "submenu",
            label: "Switch",
            entries: [{ label: "nested" }],
            isSelection: true,
        });
        expect(Object.keys(navigation.entries[1])).not.toContain("isSelection");
    });
});
