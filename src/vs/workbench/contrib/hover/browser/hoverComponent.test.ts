import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { testLayoutService } from "../../../../../TestUtils/testLayoutService.ts";

import { HoverComponent } from "./hoverComponent.ts";

describe("HoverComponent — overlay-сессия попапа", () => {
    it("создаёт скрытую сессию на слое корневой view уже в конструкторе", () => {
        const body = new BodyElement();
        const component = new HoverComponent(testLayoutService(body));
        // id — контракт для инспектора и e2e-запросов по дереву.
        expect(component.view.id).toBe("hoverWidget");
        expect(body.overlayLayer.querySelector("#hoverWidget")).toBe(component.view);
        expect(component.isOpen()).toBe(false);
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
        component.dispose();
    });

    it("openAt открывает сессию, close закрывает", () => {
        const component = new HoverComponent(testLayoutService());

        component.setBlocks(["const answer: number"]);
        expect(component.isOpen()).toBe(false);

        component.openAt({ screenX: 5, screenY: 5, preferBelow: true });
        expect(component.isOpen()).toBe(true);

        // Повторный close идемпотентен.
        component.close();
        expect(component.isOpen()).toBe(false);
        component.close();
        expect(component.isOpen()).toBe(false);

        component.dispose();
    });

    it("openAt анкорит попап у каретки на каждом показе", () => {
        const body = new BodyElement();
        const app = TestApp.create(body, new Size(80, 24));
        const component = new HoverComponent(testLayoutService(body));
        component.setBlocks(["const answer: number"]);

        component.openAt({ screenX: 10, screenY: 5, preferBelow: true });
        app.render();
        expect(component.view.globalPosition.x).toBe(10);
        expect(component.view.globalPosition.y).toBe(6);

        // Повторный показ при открытом попапе — снова к новому якорю.
        component.openAt({ screenX: 20, screenY: 8, preferBelow: true });
        app.render();
        expect(component.view.globalPosition.x).toBe(20);
        expect(component.view.globalPosition.y).toBe(9);

        component.dispose();
    });

    it("dispose закрывает живую сессию", () => {
        const component = new HoverComponent(testLayoutService());
        component.setBlocks(["текст"]);
        component.openAt({ screenX: 1, screenY: 1, preferBelow: true });
        expect(component.isOpen()).toBe(true);

        component.dispose();
        expect(component.isOpen()).toBe(false);
    });
});
