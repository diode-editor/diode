import { describe, expect, it, vi } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { BoxElement } from "@tuidom/elements/layout/boxElement";
import type { MenuEntry, MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import { PopupMenuElement } from "@tuidom/elements/menu/popupMenuElement";
import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { MENU_CONTRIBUTIONS } from "../../../workbench/browser/actions/menuContributions.ts";
import { MenuId } from "../../actions/common/menuId.ts";
import { MenuRegistry } from "../../actions/common/menuRegistry.ts";
import { MenuService } from "../../actions/common/menuService.ts";
import { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../keybinding/common/keybindingRegistry.ts";

import { ContextMenuService } from "./contextMenuService.ts";

function setup(): { app: TestApp; owner: TUIElement; service: ContextMenuService; executed: string[] } {
    const owner = new BoxElement();
    const app = TestApp.createWithContent(owner, new Size(60, 16));

    const commands = new CommandRegistry();
    const executed: string[] = [];
    for (const [id, title] of [
        ["editor.action.clipboardCopyAction", "Copy"],
        ["editor.action.clipboardCutAction", "Cut"],
        ["editor.action.clipboardPasteAction", "Paste"],
        ["undo", "Undo"],
    ] as const) {
        commands.register(id, () => executed.push(id), title);
    }
    const menuService = new MenuService(
        new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), MENU_CONTRIBUTIONS),
    );
    return { app, owner, service: new ContextMenuService(menuService), executed };
}

function openMenuLabels(app: TestApp): string[] {
    const items = app.root.overlayLayer.getItems();
    expect(items.length).toBe(1);
    const popup = items[0].element as PopupMenuElement;
    return popup.entries.map((e) => (e.type === "separator" ? "─" : e.label));
}

describe("ContextMenuService", () => {
    it("opens a menu from a plain delegate with its own entries", () => {
        const { app, owner, service } = setup();

        service.showContextMenu({
            getOwner: () => owner,
            getAnchor: () => ({ screenX: 4, screenY: 3 }),
            getEntries: () => [{ label: "Rename" }, { label: "Delete" }],
        });

        expect(service.isContextMenuVisible()).toBe(true);
        expect(openMenuLabels(app)).toEqual(["Rename", "Delete"]);
    });

    it("collects registry entries for a menuId delegate and executes commands", () => {
        const { app, owner, service, executed } = setup();

        service.showContextMenu({
            getOwner: () => owner,
            getAnchor: () => ({ screenX: 4, screenY: 3 }),
            menuId: MenuId.EditorContext,
        });

        expect(openMenuLabels(app)).toEqual(["Copy", "Cut", "Paste", "─", "Undo"]);

        const popup = app.root.overlayLayer.getItems()[0].element as PopupMenuElement;
        const first = popup.entries.find((e): e is MenuItemEntry => e.type !== "separator");
        first?.onSelect?.();

        expect(executed).toEqual(["editor.action.clipboardCopyAction"]);
        // Выбор пункта закрыл меню.
        expect(service.isContextMenuVisible()).toBe(false);
    });

    it("joins delegate entries and registry entries with a separator", () => {
        const { app, owner, service } = setup();

        service.showContextMenu({
            getOwner: () => owner,
            getAnchor: () => ({ screenX: 4, screenY: 3 }),
            getEntries: (): MenuEntry[] => [{ label: "Open File" }],
            menuId: MenuId.EditorContext,
        });

        expect(openMenuLabels(app)).toEqual(["Open File", "─", "Copy", "Cut", "Paste", "─", "Undo"]);
    });

    it("does not open an empty menu", () => {
        const { app, owner, service } = setup();

        service.showContextMenu({
            getOwner: () => owner,
            getAnchor: () => ({ screenX: 4, screenY: 3 }),
        });

        expect(service.isContextMenuVisible()).toBe(false);
        expect(app.root.overlayLayer.getItems().length).toBe(0);
    });

    it("hideContextMenu closes the menu and fires onHide", () => {
        const { owner, service } = setup();
        const onHide = vi.fn();

        service.showContextMenu({
            getOwner: () => owner,
            getAnchor: () => ({ screenX: 4, screenY: 3 }),
            getEntries: () => [{ label: "Rename" }],
            onHide,
        });
        service.hideContextMenu();

        expect(service.isContextMenuVisible()).toBe(false);
        expect(onHide).toHaveBeenCalledOnce();
    });

    it("меню резолвит цвета из корневого var-scope (тема без пуша стилей)", () => {
        const { app, owner, service } = setup();
        const bg = packRgb(0x0a, 0x1b, 0x2c);
        app.root.setStyleVars({ "menu.background": bg });

        service.showContextMenu({
            getOwner: () => owner,
            getAnchor: () => ({ screenX: 4, screenY: 3 }),
            getEntries: () => [{ label: "Rename" }],
        });
        app.render();

        const item = app.root.overlayLayer.getItems()[0];
        expect(app.backend.getBgAt(new Point(item.position.x, item.position.y))).toBe(bg);
    });
});
