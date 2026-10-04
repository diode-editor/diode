import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { testLayoutService } from "../../../../../TestUtils/testLayoutService.ts";

import { SuggestComponent } from "./suggestComponent.ts";

/** Компонент на корне 80×24 с одним пунктом — попапу есть что показывать. */
function setup(): { component: SuggestComponent; app: TestApp } {
    const body = new BodyElement();
    const app = TestApp.create(body, new Size(80, 24));
    const component = new SuggestComponent(testLayoutService(body));
    component.view.setItems([{ label: "indent_size" }]);
    return { component, app };
}

function click(app: TestApp, x: number, y: number): void {
    for (const action of ["press", "release"] as const) {
        const token: MouseToken = {
            kind: "mouse",
            button: "left",
            action,
            x,
            y,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        };
        app.backend.simulateMouse(token);
    }
}

describe("SuggestComponent — overlay-сессия", () => {
    it("сессия на слое корня создаётся скрытой", () => {
        const body = new BodyElement();
        const component = new SuggestComponent(testLayoutService(body));

        expect(body.overlayLayer.querySelector("#suggestWidget")).toBe(component.widget);
        expect(component.isOpen()).toBe(false);
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("клик мимо попапа закрывает его (pointer-политика сессии)", () => {
        const { component, app } = setup();
        component.openAt({ screenX: 10, screenY: 5, preferBelow: true });
        app.render();
        expect(component.isOpen()).toBe(true);

        click(app, 70, 20);

        expect(component.isOpen()).toBe(false);
    });

    it("dispose снимает попап со слоя корня", () => {
        const body = new BodyElement();
        const component = new SuggestComponent(testLayoutService(body));

        component.dispose();

        expect(body.overlayLayer.querySelector("#suggestWidget")).toBeNull();
    });
});

/**
 * Попап живёт у каретки: каждый путь показа и движения обязан пере-анкорить
 * сессию, иначе слой оставит его там, где он был (или в углу экрана).
 */
describe("SuggestComponent — позиция попапа у каретки", () => {
    it("openAt ставит попап под якорь", () => {
        const { component, app } = setup();

        component.openAt({ screenX: 10, screenY: 5, preferBelow: true });
        app.render();

        expect(component.widget.globalPosition.x).toBe(10);
        expect(component.widget.globalPosition.y).toBe(6);
    });

    it("setAnchor двигает открытый попап вслед за кареткой", () => {
        const { component, app } = setup();
        component.openAt({ screenX: 10, screenY: 5, preferBelow: true });
        app.render();

        component.setAnchor({ screenX: 20, screenY: 8, preferBelow: true });
        app.render();

        expect(component.widget.globalPosition.x).toBe(20);
        expect(component.widget.globalPosition.y).toBe(9);
    });

    it("refreshDetailsLayout пере-анкорит к последнему якорю", () => {
        const { component, app } = setup();
        component.openAt({ screenX: 10, screenY: 5, preferBelow: true });
        app.render();
        // Сдвигаем сессию мимо компонента — пере-анкор обязан вернуть попап.
        (component as unknown as { overlay: { setAnchor(a: unknown): void } }).overlay.setAnchor({
            screenX: 30,
            screenY: 15,
            preferBelow: true,
        });
        app.render();

        component.refreshDetailsLayout();
        app.render();

        expect(component.widget.globalPosition.x).toBe(10);
        expect(component.widget.globalPosition.y).toBe(6);
    });
});
