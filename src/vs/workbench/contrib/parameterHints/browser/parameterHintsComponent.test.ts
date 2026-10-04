import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { testLayoutService } from "../../../../../TestUtils/testLayoutService.ts";

import { ParameterHintsComponent } from "./parameterHintsComponent.ts";
import type { IParameterHint } from "./parameterHintsElement.ts";

const HINT: IParameterHint = {
    label: "greet(name: string): void",
    activeSpan: [6, 18],
    counter: null,
    documentation: [],
};

describe("ParameterHintsComponent — overlay-сессия попапа", () => {
    it("создаёт скрытую сессию на слое корневой view уже в конструкторе", () => {
        const body = new BodyElement();
        const component = new ParameterHintsComponent(testLayoutService(body));
        // id — контракт для инспектора и e2e-запросов по дереву.
        expect(component.view.id).toBe("parameterHintsWidget");
        expect(body.overlayLayer.querySelector("#parameterHintsWidget")).toBe(component.view);
        expect(component.isOpen()).toBe(false);
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
        component.dispose();
    });

    it("openAt открывает сессию, close закрывает и идемпотентен", () => {
        const component = new ParameterHintsComponent(testLayoutService());

        component.setHint(HINT);
        expect(component.isOpen()).toBe(false);

        component.openAt({ screenX: 5, screenY: 5, preferBelow: true });
        expect(component.isOpen()).toBe(true);

        component.close();
        expect(component.isOpen()).toBe(false);
        component.close();
        expect(component.isOpen()).toBe(false);

        component.dispose();
    });

    it("попап встаёт НАД строкой каретки, даже когда якорь просит низ", () => {
        const body = new BodyElement();
        const app = TestApp.create(body, new Size(80, 24));
        const component = new ParameterHintsComponent(testLayoutService(body));
        component.setHint(HINT);

        // Якорь редактора всегда приходит с preferBelow: true (см. getCaretAnchor) —
        // подсказка обязана его перевернуть, иначе легла бы на попап автодополнения.
        component.openAt({ screenX: 10, screenY: 12, preferBelow: true });
        app.render();

        const height = component.view.getMaxIntrinsicHeight(component.view.getMaxIntrinsicWidth(0));
        // Нижняя строка попапа — ровно над строкой каретки, сама строка видна.
        expect(component.view.globalPosition.y).toBe(12 - height);

        component.dispose();
    });

    it("места ровно в высоту попапа хватает — он остаётся сверху", () => {
        const body = new BodyElement();
        const app = TestApp.create(body, new Size(80, 24));
        const component = new ParameterHintsComponent(testLayoutService(body));
        component.setHint(HINT);
        const height = component.view.getMaxIntrinsicHeight(component.view.getMaxIntrinsicWidth(0));

        // Граница включительная: попап ровно упирается в верх экрана.
        component.openAt({ screenX: 10, screenY: height, preferBelow: true });
        app.render();

        expect(component.view.globalPosition.y).toBe(0);

        component.dispose();
    });

    it("сверху места нет — попап уходит под каретку, а не накрывает её", () => {
        const body = new BodyElement();
        const app = TestApp.create(body, new Size(80, 24));
        const component = new ParameterHintsComponent(testLayoutService(body));
        component.setHint(HINT);

        component.openAt({ screenX: 10, screenY: 0, preferBelow: true });
        app.render();

        expect(component.view.globalPosition.y).toBe(1);

        component.dispose();
    });

    it("dispose закрывает живую сессию", () => {
        const component = new ParameterHintsComponent(testLayoutService());
        component.setHint(HINT);
        component.openAt({ screenX: 1, screenY: 1, preferBelow: true });
        expect(component.isOpen()).toBe(true);

        component.dispose();
        expect(component.isOpen()).toBe(false);
    });
});
