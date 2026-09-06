import { describe, expect, it } from "vitest";

import { BodyElement } from "@tuidom/elements/body/bodyElement";

import { HoverComponent } from "./hoverComponent.ts";

describe("HoverComponent — overlay-сессия попапа", () => {
    it("до attachHost попап не открывается и не падает", () => {
        const component = new HoverComponent();
        // id — контракт для инспектора и e2e-запросов по дереву.
        expect(component.view.id).toBe("hoverWidget");

        component.setBlocks(["текст"]);
        component.openAt({ screenX: 5, screenY: 5, preferBelow: true });
        component.close();

        expect(component.isOpen()).toBe(false);
        component.dispose();
    });

    it("после attachHost openAt открывает сессию, close закрывает", () => {
        const component = new HoverComponent();
        const body = new BodyElement();
        component.attachHost(body);

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

    it("dispose закрывает живую сессию", () => {
        const component = new HoverComponent();
        const body = new BodyElement();
        component.attachHost(body);
        component.setBlocks(["текст"]);
        component.openAt({ screenX: 1, screenY: 1, preferBelow: true });
        expect(component.isOpen()).toBe(true);

        component.dispose();
        expect(component.isOpen()).toBe(false);
    });
});
