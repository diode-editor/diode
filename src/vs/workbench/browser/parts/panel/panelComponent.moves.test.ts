import { BoxConstraints, Offset, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IPaneCompositeTabContextMenuRequest } from "../paneCompositePartService.ts";

import { PanelComponent } from "./panelComponent.ts";
import { PanelContainerElement } from "./panelContainerElement.ts";
import { PanelService } from "./panelService.ts";

describe("PanelComponent — вкладки уходят и возвращаются", () => {
    it("снятая в реестре вкладка уходит из таб-строки", () => {
        const service = new PanelService();
        const component = new PanelComponent(service, new CommandRegistry());
        service.addView({ id: "a", title: "A" });
        service.addView({ id: "b", title: "B" });
        service.removeView("a");
        expect(component.view.getViewIds()).toEqual(["b"]);
        expect(component.view.getActiveViewId()).toBe("b");
    });

    it("вернувшаяся вкладка встаёт на позицию из реестра, а не в хвост", () => {
        const service = new PanelService();
        const component = new PanelComponent(service, new CommandRegistry());
        service.addView({ id: "a", title: "A" });
        service.addView({ id: "b", title: "B" });
        service.removeView("a");
        service.addView({ id: "a", title: "A", index: 0 });
        expect(component.view.getViewIds()).toEqual(["a", "b"]);
    });

    it("контрол: снятая активная передаёт активность первой оставшейся, неактивная — не трогает", () => {
        const view = new PanelContainerElement();
        for (const id of ["a", "b", "c"]) view.addView({ id, title: id, content: null });
        view.setActiveView("b");
        view.removeView("c");
        expect(view.getActiveViewId()).toBe("b");
        view.removeView("b");
        expect(view.getActiveViewId()).toBe("a");
        view.removeView("a");
        expect(view.getActiveViewId()).toBeNull();
        expect(view.getViewIds()).toEqual([]);
    });

    it("снятие незнакомой контролу вкладки — no-op", () => {
        const component = new PanelComponent(new PanelService(), new CommandRegistry());
        component.view.removeView("ghost");
        expect(component.view.getViewIds()).toEqual([]);
    });
});

describe("PanelComponent — контекстное меню вкладки", () => {
    function scene() {
        const service = new PanelService();
        const component = new PanelComponent(service, new CommandRegistry());
        service.addView({ id: "problems", title: "PROBLEMS" });
        service.addView({ id: "output", title: "OUTPUT" });
        const requests: IPaneCompositeTabContextMenuRequest[] = [];
        service.onDidRequestTabContextMenu((request) => requests.push(request));
        // Панель по смещению: экранные координаты ≠ локальным.
        component.view.localPosition = new Offset(5, 3);
        component.view.layout(BoxConstraints.tight(new Size(40, 8)));
        const menu = (trigger: "mouse" | "keyboard", screenX: number, screenY: number): boolean => {
            const event = new TUIContextMenuEvent({
                trigger,
                button: trigger === "mouse" ? "right" : "none",
                screenX,
                screenY,
                localX: screenX - 5,
                localY: screenY - 3,
            });
            component.view.dispatchEvent(event);
            return event.defaultPrevented;
        };
        return { component, requests, menu };
    }

    it("правый клик по вкладке — запрос меню с её id, точкой клика и владельцем-панелью", () => {
        const { component, requests, menu } = scene();
        // Таб-строка панели — её строка 1; OUTPUT — колонки 11..18 панели.
        expect(menu("mouse", 5 + 13, 3 + 1)).toBe(true);
        expect(requests).toEqual([{ id: "output", anchor: { screenX: 18, screenY: 4 }, owner: component.view }]);
        // Правый клик вкладку не переключает.
        expect(component.view.getActiveViewId()).toBe("problems");
    });

    it("Shift+F10 — меню активной вкладки под её началом", () => {
        const { component, requests, menu } = scene();
        menu("keyboard", 0, 0);
        expect(requests).toEqual([
            { id: "problems", anchor: { screenX: 5 + 1, screenY: 3 + 2 }, owner: component.view },
        ]);
    });

    it("попадание по колонкам: вкладка — от первой колонки своего сегмента до последней", () => {
        const { requests, menu } = scene();
        let map = "";
        for (let x = 0; x < 24; x++) {
            requests.length = 0;
            menu("mouse", 5 + x, 3 + 1);
            map += requests.at(0)?.id.charAt(0) ?? ".";
        }
        // PROBLEMS — колонки 1..10 (с отступами таба), OUTPUT — 11..18.
        expect(map).toBe(".ppppppppppoooooooo.....");
    });

    it("Shift+F10 — меню именно активной вкладки, не первой", () => {
        const { component, requests, menu } = scene();
        component.view.setActiveView("output");
        menu("keyboard", 0, 0);
        expect(requests).toEqual([
            { id: "output", anchor: { screenX: 5 + 11, screenY: 3 + 2 }, owner: component.view },
        ]);
    });

    it("без подписчика на меню вкладки — событие гасится без ошибки", () => {
        const view = new PanelContainerElement();
        view.addView({ id: "a", title: "A", content: null });
        view.layout(BoxConstraints.tight(new Size(20, 4)));
        const event = new TUIContextMenuEvent({
            trigger: "keyboard",
            button: "none",
            screenX: 0,
            screenY: 0,
            localX: 0,
            localY: 0,
        });
        view.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it("мимо вкладок и вне таб-строки меню не просит и событие не гасит", () => {
        const { requests, menu } = scene();
        expect(menu("mouse", 5 + 30, 3 + 1)).toBe(false);
        expect(menu("mouse", 5 + 13, 3 + 4)).toBe(false);
        expect(menu("mouse", 5 + 13, 3)).toBe(false);
        expect(requests).toEqual([]);
    });

    it("событие, всплывшее из контента вкладки, — не меню вкладки", () => {
        const service = new PanelService();
        const component = new PanelComponent(service, new CommandRegistry());
        const content = new TUIElement();
        service.addView({ id: "problems", title: "PROBLEMS", content });
        const requests: IPaneCompositeTabContextMenuRequest[] = [];
        service.onDidRequestTabContextMenu((request) => requests.push(request));
        component.view.layout(BoxConstraints.tight(new Size(40, 8)));
        content.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "keyboard",
                button: "none",
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
            }),
        );
        expect(requests).toEqual([]);
    });
});
