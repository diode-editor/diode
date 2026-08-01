import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import { InputElement } from "../inputbox/inputElement.ts";
import type { MenuEntry, MenuItemEntry } from "../menu/popupMenuElement.ts";
import { PopupMenuElement } from "../menu/popupMenuElement.ts";

import { ContextMenuController } from "./contextMenuController.ts";

function setup(): { app: TestApp; input: InputElement; controller: ContextMenuController } {
    const input = new InputElement();
    const app = TestApp.createWithContent(input, new Size(40, 12));
    return { app, input, controller: new ContextMenuController() };
}

function show(controller: ContextMenuController, owner: TUIElement, entries: MenuEntry[], onHide?: () => void): void {
    controller.show({ owner, anchor: { screenX: 3, screenY: 2 }, entries, onHide });
}

describe("ContextMenuController", () => {
    it("opens a popup menu in the owner's overlay layer", () => {
        const { app, input, controller } = setup();

        show(controller, input, [{ label: "Copy" }, { type: "separator" }, { label: "Paste" }]);

        expect(controller.isOpen()).toBe(true);
        const items = app.root.overlayLayer.getItems();
        expect(items.length).toBe(1);
        expect(items[0].element).toBeInstanceOf(PopupMenuElement);
        expect(items[0].visible).toBe(true);
    });

    it("does not open for empty entries or for an owner without a layer", () => {
        const { input, controller } = setup();

        show(controller, input, []);
        expect(controller.isOpen()).toBe(false);

        show(controller, new TUIElement(), [{ label: "Copy" }]);
        expect(controller.isOpen()).toBe(false);
    });

    it("closes the menu before running the entry action", () => {
        const { app, input, controller } = setup();
        const order: string[] = [];
        show(controller, input, [
            {
                label: "Copy",
                onSelect: () => {
                    order.push(`select:open=${controller.isOpen().toString()}`);
                },
            },
        ]);
        expect(controller.isOpen()).toBe(true);

        const popup = app.root.overlayLayer.getItems()[0].element as PopupMenuElement;
        popup.entries.find((e): e is MenuItemEntry => e.type !== "separator" && e.type !== "submenu")?.onSelect?.();

        // Обёртка закрыла меню до пользовательского действия.
        expect(order).toEqual(["select:open=false"]);
    });

    it("show replaces the previous session", () => {
        const { app, input, controller } = setup();

        show(controller, input, [{ label: "First" }]);
        show(controller, input, [{ label: "Second" }]);

        const items = app.root.overlayLayer.getItems();
        expect(items.length).toBe(1);
        expect((items[0].element as PopupMenuElement).entries[0].type !== "separator").toBe(true);
        expect(controller.isOpen()).toBe(true);
    });

    it("hide closes the session, restores focus and fires onHide", () => {
        const { app, input, controller } = setup();
        input.focus();
        const onHide = vi.fn();

        show(controller, input, [{ label: "Copy" }], onHide);
        expect(app.focusedElement).not.toBe(input);

        controller.hide();

        expect(controller.isOpen()).toBe(false);
        expect(onHide).toHaveBeenCalledOnce();
        expect(app.focusedElement).toBe(input);
        expect(app.root.overlayLayer.getItems().length).toBe(0);
    });

    it("hide is a no-op when nothing is open", () => {
        const { controller } = setup();
        expect(() => {
            controller.hide();
        }).not.toThrow();
    });

    it("Escape closes the menu", () => {
        const { app, input, controller } = setup();
        const onHide = vi.fn();

        show(controller, input, [{ label: "Copy" }], onHide);
        app.sendKey("Escape");

        expect(controller.isOpen()).toBe(false);
        expect(onHide).toHaveBeenCalledOnce();
    });

    it("a click outside closes the menu", () => {
        const { app, input, controller } = setup();

        show(controller, input, [{ label: "Copy" }]);
        app.root.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: 30, screenY: 10, localX: 30, localY: 10 }),
        );

        expect(controller.isOpen()).toBe(false);
    });

    it("menu.onClose (Escape inside the menu) closes the session", () => {
        const { app, input, controller } = setup();

        show(controller, input, [{ label: "Copy" }]);
        const popup = app.root.overlayLayer.getItems()[0].element as PopupMenuElement;
        popup.onClose?.();

        expect(controller.isOpen()).toBe(false);
    });

    it("попап резолвит цвета из var-scope корня", () => {
        const { app, input, controller } = setup();
        const bg = packRgb(0x12, 0x34, 0x56);
        app.root.setStyleVars({ "menu.background": bg });

        controller.show({
            owner: input,
            anchor: { screenX: 3, screenY: 2 },
            entries: [{ label: "Copy" }],
        });
        app.render();

        const item = app.root.overlayLayer.getItems()[0];
        expect(app.backend.getBgAt(new Point(item.position.x, item.position.y))).toBe(bg);
    });
});
