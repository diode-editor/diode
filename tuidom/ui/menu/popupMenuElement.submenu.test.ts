import { describe, expect, it } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { ContextMenuController } from "../contextview/contextMenuController.ts";
import { InputElement } from "../inputbox/inputElement.ts";

import type { MenuEntry } from "./popupMenuElement.ts";
import { PopupMenuElement } from "./popupMenuElement.ts";
import { PopupMenuItemElement } from "./popupMenuItemElement.tsx";

interface ISetup {
    app: TestApp;
    controller: ContextMenuController;
    selected: string[];
}

function setup(entries?: MenuEntry[], screen = new Size(60, 16)): ISetup {
    const input = new InputElement();
    const app = TestApp.createWithContent(input, screen);
    const controller = new ContextMenuController();
    const selected: string[] = [];

    controller.show({
        owner: input,
        anchor: { screenX: 2, screenY: 1 },
        entries: entries ?? [
            { label: "Copy", onSelect: () => selected.push("Copy") },
            {
                type: "submenu",
                label: "Open With",
                entries: [
                    { label: "Editor", onSelect: () => selected.push("Editor") },
                    {
                        type: "submenu",
                        label: "More",
                        entries: [{ label: "Hex", onSelect: () => selected.push("Hex") }],
                    },
                ],
            },
        ],
        onHide: () => selected.push("<hidden>"),
    });
    return { app, controller, selected };
}

function layerItems(app: TestApp): readonly { element: unknown }[] {
    return app.root.overlayLayer.getItems();
}

function rootMenu(app: TestApp): PopupMenuElement {
    return app.root.overlayLayer.getItems()[0].element as PopupMenuElement;
}

describe("PopupMenuElement — вложенные подменю", () => {
    it("renders the › indicator in the shortcut column", () => {
        const { app } = setup();
        app.render();

        const menu = rootMenu(app);
        const pos = menu.globalPosition;
        let rendered = "";
        for (let y = 0; y < menu.layoutSize.height; y++) {
            rendered += app.backend.getTextAt(new Point(pos.x, pos.y + y), menu.layoutSize.width);
        }
        expect(rendered).toContain("Open With");
        expect(rendered).toContain("›");
    });

    it("opens a child popup with Enter and with ArrowRight on the submenu row", () => {
        const { app } = setup();

        app.sendKey("ArrowDown"); // на строку Open With
        app.sendKey("ArrowRight");
        expect(layerItems(app).length).toBe(2);

        // Повторный ArrowRight на той же строке ничего не дублирует.
        app.sendKey("ArrowRight");
        expect(layerItems(app).length).toBe(2);
    });

    it("opens a child popup with Enter on the submenu row", () => {
        const { app } = setup();

        app.sendKey("ArrowDown"); // на строку Open With
        app.sendKey("Enter");

        expect(layerItems(app).length).toBe(2);
    });

    it("hovering the submenu row moves the selection onto it", () => {
        const { app } = setup();
        const menu = rootMenu(app);
        const items = menu
            .getChildren()[0]
            .getChildren()
            .filter((el) => el instanceof PopupMenuItemElement);

        items[1].onHover?.(); // ховер на Open With

        expect(menu.selectedIndex).toBe(1);
    });

    it("opening another submenu closes the currently open one", () => {
        const { app } = setup([
            { type: "submenu", label: "First", entries: [{ label: "A" }] },
            { type: "submenu", label: "Second", entries: [{ label: "B" }] },
        ]);
        app.sendKey("ArrowRight"); // открыт First
        expect(layerItems(app).length).toBe(2);

        const menu = rootMenu(app);
        const items = menu
            .getChildren()[0]
            .getChildren()
            .filter((el) => el instanceof PopupMenuItemElement);
        items[1].onSelect?.(); // клик по Second

        expect(layerItems(app).length).toBe(2); // First закрыт, Second открыт
        const child = layerItems(app)[1].element as PopupMenuElement;
        expect(child.entries.map((e) => (e.type === "separator" ? "─" : e.label))).toEqual(["B"]);
    });

    it("selecting a leaf two levels deep closes the whole chain (closeAll recursion)", () => {
        const { app, controller, selected } = setup();

        app.sendKey("ArrowDown");
        app.sendKey("ArrowRight"); // уровень 2
        app.sendKey("ArrowDown"); // на More
        app.sendKey("ArrowRight"); // уровень 3
        app.sendKey("Enter"); // Hex

        expect(selected).toContain("Hex");
        expect(controller.isOpen()).toBe(false);
        expect(layerItems(app).length).toBe(0);
    });

    it("Enter on a submenu row of a detached menu (no layer) is a no-op", () => {
        const menu = new PopupMenuElement([{ type: "submenu", label: "Lost", entries: [{ label: "X" }] }]);

        expect(() => {
            menu.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        }).not.toThrow();
        expect(menu.hasOpenSubmenu()).toBe(false);
    });

    it("opens a child popup on mouse click on the submenu row; a second click does not duplicate it", () => {
        const { app } = setup();
        app.render();

        const menu = rootMenu(app);
        const items = menu
            .getChildren()[0]
            .getChildren()
            .filter((el) => el instanceof PopupMenuItemElement);
        items[1].onSelect?.();
        expect(layerItems(app).length).toBe(2);
        const child = layerItems(app)[1].element;

        // Повторный клик по той же строке — гард «уже открыто», без пересоздания.
        items[1].onSelect?.();
        expect(layerItems(app).length).toBe(2);
        expect(layerItems(app)[1].element).toBe(child);
    });

    it("anchors the child to the right of the parent at the row's line", () => {
        const { app } = setup();
        app.sendKey("ArrowDown");
        app.sendKey("ArrowRight");
        app.render();

        const parent = app.root.overlayLayer.getItems()[0];
        const child = app.root.overlayLayer.getItems()[1];
        expect(child.position.x).toBe(parent.position.x + rootMenu(app).layoutSize.width);
        // Строка Open With — вторая строка контента (граница + Copy + Open With).
        expect(child.position.y).toBe(parent.position.y + 2);
    });

    it("clamps the child at the right screen edge", () => {
        const { app } = setup(undefined, new Size(30, 12));
        app.sendKey("ArrowDown");
        app.sendKey("ArrowRight");
        app.render();

        const child = app.root.overlayLayer.getItems()[1];
        const childMenu = child.element as PopupMenuElement;
        expect(child.position.x + childMenu.layoutSize.width).toBeLessThanOrEqual(30);
    });

    it("ArrowLeft closes one level, Escape closes only the deepest, second Escape closes the root", () => {
        const { app, controller } = setup();

        app.sendKey("ArrowDown");
        app.sendKey("ArrowRight"); // открыт уровень 2
        app.sendKey("ArrowDown"); // в подменю: на строку More
        app.sendKey("ArrowRight"); // открыт уровень 3
        expect(layerItems(app).length).toBe(3);

        app.sendKey("ArrowLeft");
        expect(layerItems(app).length).toBe(2);

        app.sendKey("Escape");
        expect(layerItems(app).length).toBe(1);
        expect(controller.isOpen()).toBe(true);

        app.sendKey("Escape");
        expect(layerItems(app).length).toBe(0);
        expect(controller.isOpen()).toBe(false);
    });

    it("selecting a leaf inside a submenu closes the whole chain before the action", () => {
        const { app, controller, selected } = setup();

        app.sendKey("ArrowDown");
        app.sendKey("ArrowRight");
        app.sendKey("Enter"); // Editor — первая строка подменю

        expect(selected).toContain("Editor");
        // Всё меню закрыто, onHide отработал до действия.
        expect(controller.isOpen()).toBe(false);
        expect(layerItems(app).length).toBe(0);
        expect(selected.indexOf("<hidden>")).toBeLessThan(selected.indexOf("Editor"));
    });

    it("a click on the child popup does not close the chain; a click outside closes everything", () => {
        const { app, controller } = setup();
        app.sendKey("ArrowDown");
        app.sendKey("ArrowRight");
        app.render();

        const child = app.root.overlayLayer.getItems()[1].element as PopupMenuElement;
        child.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 }),
        );
        expect(layerItems(app).length).toBe(2);

        app.root.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: 55, screenY: 15, localX: 55, localY: 15 }),
        );
        expect(controller.isOpen()).toBe(false);
        expect(layerItems(app).length).toBe(0);
    });

    it("hovering another parent row closes the open child", () => {
        const { app } = setup();
        app.sendKey("ArrowDown");
        app.sendKey("ArrowRight");
        expect(layerItems(app).length).toBe(2);

        const menu = rootMenu(app);
        const items = menu
            .getChildren()[0]
            .getChildren()
            .filter((el) => el instanceof PopupMenuItemElement);
        items[0].onHover?.(); // ховер на Copy

        expect(layerItems(app).length).toBe(1);
    });

    it("resolves lazy entries at open time and skips empty submenus", () => {
        let resolved = 0;
        const { app } = setup([
            { label: "Copy" },
            {
                type: "submenu",
                label: "Lazy",
                entries: () => {
                    resolved++;
                    return [{ label: "Late" }];
                },
            },
            { type: "submenu", label: "Empty", entries: [] },
        ]);

        expect(resolved).toBe(0);

        app.sendKey("ArrowDown"); // Lazy
        app.sendKey("ArrowRight");
        expect(resolved).toBe(1);
        expect(layerItems(app).length).toBe(2);

        app.sendKey("ArrowLeft");
        app.sendKey("ArrowDown"); // Empty
        app.sendKey("ArrowRight");
        expect(layerItems(app).length).toBe(1); // пустое подменю не открылось
    });

    it("controller.hide() cascades through open submenus", () => {
        const { app, controller } = setup();
        app.sendKey("ArrowDown");
        app.sendKey("ArrowRight");
        app.sendKey("ArrowDown");
        app.sendKey("ArrowRight");
        expect(layerItems(app).length).toBe(3);

        controller.hide();

        expect(layerItems(app).length).toBe(0);
    });
});
