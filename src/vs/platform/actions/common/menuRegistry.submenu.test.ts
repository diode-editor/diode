import { describe, expect, it } from "vitest";

import type { MenuSubmenuEntry } from "../../../../../tuidom/ui/menu/popupMenuElement.ts";
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

describe("MenuRegistry — submenu-записи в getMenuItems", () => {
    it("без резолвера submenu-записи отфильтровываются (поведение меню-бара)", () => {
        const registry = makeRegistry([
            { menuId: TEST_MENU, command: "cmd.a" },
            { menuId: TEST_MENU, submenu: TEST_SUB, title: "Nested" },
        ]);

        const labels = registry.getMenuItems(TEST_MENU).map((e) => (e.type === "separator" ? "─" : e.label));
        expect(labels).toEqual(["Alpha"]);
    });

    it("с резолвером submenu встраивается в свой group/order-слот", () => {
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

    it("null от резолвера выбрасывает пункт; опустевшая группа не оставляет сепаратора", () => {
        const registry = makeRegistry([
            { menuId: TEST_MENU, command: "cmd.a", group: "1_a" },
            { menuId: TEST_MENU, submenu: TEST_SUB, title: "Dropped", group: "2_b" },
        ]);

        const labels = registry
            .getMenuItems(TEST_MENU, undefined, () => null)
            .map((e) => (e.type === "separator" ? "─" : e.label));
        expect(labels).toEqual(["Alpha"]);
    });

    it("when-фильтр применяется к submenu-записи и с резолвером", () => {
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
