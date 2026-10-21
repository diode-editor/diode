import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { testLayoutService } from "../../../../../TestUtils/testLayoutService.ts";

import { SuggestComponent } from "./suggestComponent.ts";

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

describe("SuggestComponent — overlay session", () => {
    it("the session on the root layer is created hidden", () => {
        const body = new BodyElement();
        const component = new SuggestComponent(testLayoutService(body));

        expect(body.overlayLayer.querySelector("#suggestWidget")).toBe(component.widget);
        expect(component.isOpen()).toBe(false);
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("a click outside the popup closes it (session pointer policy)", () => {
        const { component, app } = setup();
        component.openAt({ screenX: 10, screenY: 5, preferBelow: true });
        app.render();
        expect(component.isOpen()).toBe(true);

        click(app, 70, 20);

        expect(component.isOpen()).toBe(false);
    });

    it("dispose removes the popup from the root layer", () => {
        const body = new BodyElement();
        const component = new SuggestComponent(testLayoutService(body));

        component.dispose();

        expect(body.overlayLayer.querySelector("#suggestWidget")).toBeNull();
    });
});

/** Every show and move path must re-anchor the session, otherwise the layer leaves the popup in place. */
describe("SuggestComponent — popup position at the cursor", () => {
    it("openAt places the popup below the anchor", () => {
        const { component, app } = setup();

        component.openAt({ screenX: 10, screenY: 5, preferBelow: true });
        app.render();

        expect(component.widget.globalPosition.x).toBe(10);
        expect(component.widget.globalPosition.y).toBe(6);
    });

    it("setAnchor moves the open popup along with the cursor", () => {
        const { component, app } = setup();
        component.openAt({ screenX: 10, screenY: 5, preferBelow: true });
        app.render();

        component.setAnchor({ screenX: 20, screenY: 8, preferBelow: true });
        app.render();

        expect(component.widget.globalPosition.x).toBe(20);
        expect(component.widget.globalPosition.y).toBe(9);
    });

    it("refreshDetailsLayout re-anchors to the last anchor", () => {
        const { component, app } = setup();
        component.openAt({ screenX: 10, screenY: 5, preferBelow: true });
        app.render();
        // Move the session behind the component's back — the re-anchor must bring the popup back.
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
