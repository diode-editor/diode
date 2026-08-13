import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { BoxElement } from "@tuidom/all/ui/layout/boxElement";
import type { MenuEntry, MenuSubmenuEntry } from "@tuidom/all/ui/menu/popupMenuElement";
import { PopupMenuElement } from "@tuidom/all/ui/menu/popupMenuElement";
import { TestApp } from "../../../../TestUtils/TestApp.ts";
import type { MenuContribution } from "../../actions/common/iMenuContribution.ts";
import { MenuId } from "../../actions/common/menuId.ts";
import { MenuRegistry } from "../../actions/common/menuRegistry.ts";
import { MenuService } from "../../actions/common/menuService.ts";
import { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../keybinding/common/keybindingRegistry.ts";

import { ContextMenuService } from "./contextMenuService.ts";

const ROOT = new MenuId("test.ctxsvc.root");
const NESTED = new MenuId("test.ctxsvc.nested");
const EMPTY = new MenuId("test.ctxsvc.empty");
const CYCLE_A = new MenuId("test.ctxsvc.cycleA");
const CYCLE_B = new MenuId("test.ctxsvc.cycleB");

function open(contributions: readonly MenuContribution[], menuId: MenuId): MenuEntry[] {
    const owner = new BoxElement();
    const app = TestApp.createWithContent(owner, new Size(60, 16));
    const commands = new CommandRegistry();
    commands.register("cmd.top", () => {}, "Top");
    commands.register("cmd.deep", () => {}, "Deep");
    const service = new ContextMenuService(
        new MenuService(new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), contributions)),
    );

    service.showContextMenu({
        getOwner: () => owner,
        getAnchor: () => ({ screenX: 2, screenY: 1 }),
        menuId,
    });
    const items = app.root.overlayLayer.getItems();
    if (items.length === 0) return [];
    return (items[0].element as PopupMenuElement).entries;
}

describe("ContextMenuService — рекурсивная сборка подменю", () => {
    it("собирает вложенное подменю из точки реестра", () => {
        const entries = open(
            [
                { menuId: ROOT, command: "cmd.top" },
                { menuId: ROOT, submenu: NESTED, title: "More" },
                { menuId: NESTED, command: "cmd.deep" },
            ],
            ROOT,
        );

        expect(entries.map((e) => (e.type === "separator" ? "─" : e.label))).toEqual(["Top", "More"]);
        const nested = entries[1] as MenuSubmenuEntry;
        expect(nested.type).toBe("submenu");
        const nestedEntries = typeof nested.entries === "function" ? nested.entries() : nested.entries;
        expect(nestedEntries.map((e) => (e.type === "separator" ? "─" : e.label))).toEqual(["Deep"]);
    });

    it("выбрасывает пустые подменю (рекурсивно ни одного пункта)", () => {
        const entries = open(
            [
                { menuId: ROOT, command: "cmd.top" },
                { menuId: ROOT, submenu: EMPTY, title: "Nothing" },
            ],
            ROOT,
        );

        expect(entries.map((e) => (e.type === "separator" ? "─" : e.label))).toEqual(["Top"]);
    });

    it("рвёт цикл MenuId: A → B → A обрывается на повторном визите", () => {
        const entries = open(
            [
                { menuId: CYCLE_A, command: "cmd.top" },
                { menuId: CYCLE_A, submenu: CYCLE_B, title: "ToB" },
                { menuId: CYCLE_B, command: "cmd.deep" },
                { menuId: CYCLE_B, submenu: CYCLE_A, title: "BackToA" },
            ],
            CYCLE_A,
        );

        const toB = entries.find((e): e is MenuSubmenuEntry => e.type === "submenu");
        expect(toB).toBeDefined();
        const bEntries = typeof toB!.entries === "function" ? toB!.entries() : toB!.entries;
        // Обратная ссылка на A выброшена (пустая из-за цикла), остался только пункт.
        expect(bEntries.map((e) => (e.type === "separator" ? "─" : e.label))).toEqual(["Deep"]);
    });
});
