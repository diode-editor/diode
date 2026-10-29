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

const LONG_LABEL =
    "gammaVeryLongNameThatIsQuiteDescriptiveAndThenSomeMoreToFillOneHundredColumnsOfTheWindowWidthEasily";

function openIn(windowWidth: number, labels: readonly string[]): { component: SuggestComponent; app: TestApp } {
    const body = new BodyElement();
    const app = TestApp.create(body, new Size(windowWidth, 24));
    app.render();
    const component = new SuggestComponent(testLayoutService(body));
    component.view.setItems(labels.map((label) => ({ label })));
    component.openAt({ screenX: 0, screenY: 0, preferBelow: true });
    app.render();
    return { component, app };
}

function resize(app: TestApp, windowWidth: number): void {
    app.backend.resize(new Size(windowWidth, 24));
    app.render();
}

/** The first list row on screen: below the anchor row and the top border. */
function popupRow(app: TestApp): string {
    return app.backend.screenToString().split("\n")[2] ?? "";
}

/** Limits are 40% of the window, clamped to 40…100 for the list and 60…100 for the details. */
describe("SuggestComponent — width follows the window", () => {
    it.each([
        [80, 40],
        [100, 40],
        [140, 56],
        [200, 80],
        [250, 100],
        [300, 100],
    ])("a window %i columns wide caps a long list at %i columns", (windowWidth, expected) => {
        const { component } = openIn(windowWidth, [LONG_LABEL]);

        expect(component.view.layoutSize.width).toBe(expected);
    });

    it("a wide window shows a long label in full, without an ellipsis", () => {
        const label = "gammaVeryLongNameThatIsQuiteDescriptive";
        const { app } = openIn(140, [label]);

        expect(popupRow(app)).toContain(label);
        expect(popupRow(app)).not.toContain("…");
    });

    it("a narrow window still cuts the same label with an ellipsis", () => {
        const { app } = openIn(80, ["gammaVeryLongNameThatIsQuiteDescriptiveXYZ"]);

        expect(popupRow(app)).toContain("…");
    });

    it("short labels keep the popup narrow in a wide window", () => {
        const { component } = openIn(200, ["alpha", "beta"]);

        expect(component.view.layoutSize.width).toBeLessThan(40);
    });

    it.each([
        [80, 60],
        [150, 60],
        [200, 80],
        [250, 100],
        [300, 100],
    ])("a window %i columns wide caps long details at %i columns", (windowWidth, expected) => {
        const { component, app } = openIn(windowWidth, ["alpha"]);
        component.detailsVisible = true;
        component.setDetailsContent({ documentation: "word ".repeat(100) });
        app.render();

        expect(component.details.layoutSize.width).toBe(expected);
    });

    it("short details keep the panel narrow in a wide window", () => {
        const { component, app } = openIn(250, ["alpha"]);
        component.detailsVisible = true;
        component.setDetailsContent({ detail: "number" });
        app.render();

        expect(component.details.layoutSize.width).toBeLessThan(60);
    });

    it("the limits follow a window resize on the next open", () => {
        const { component, app } = openIn(80, [LONG_LABEL]);
        component.close();

        resize(app, 200);
        component.openAt({ screenX: 0, screenY: 0, preferBelow: true });
        app.render();

        expect(component.view.layoutSize.width).toBe(80);
    });

    it("setAnchor recomputes the limits after a resize", () => {
        const { component, app } = openIn(80, [LONG_LABEL]);

        resize(app, 200);
        component.setAnchor({ screenX: 0, screenY: 0, preferBelow: true });
        app.render();

        expect(component.view.layoutSize.width).toBe(80);
    });

    it("refreshDetailsLayout recomputes the limits after a resize", () => {
        const { component, app } = openIn(80, [LONG_LABEL]);

        resize(app, 200);
        component.refreshDetailsLayout();
        app.render();

        expect(component.view.layoutSize.width).toBe(80);
    });

    it("the details side is chosen by the new, wider list", () => {
        // 200 columns: the list is 80 wide; at x=100 it fits alone, but not with the details on the right.
        const { component, app } = openIn(80, [LONG_LABEL]);
        component.detailsVisible = true;
        component.setDetailsContent({ documentation: "word ".repeat(100) });
        component.close();

        resize(app, 200);
        component.openAt({ screenX: 100, screenY: 0, preferBelow: true });
        app.render();

        expect(component.widget.detailsSide).toBe("left");
    });

    it("a wide list away from the right edge keeps the details on the right", () => {
        const { component, app } = openIn(200, [LONG_LABEL]);
        component.detailsVisible = true;
        component.setDetailsContent({ documentation: "documentation" });

        component.setAnchor({ screenX: 10, screenY: 0, preferBelow: true });
        app.render();

        expect(component.widget.detailsSide).toBe("right");
    });

    it("setAnchor near the right edge moves the details to the left", () => {
        const { component, app } = openIn(200, [LONG_LABEL]);
        component.detailsVisible = true;
        component.setDetailsContent({ documentation: "documentation" });

        component.setAnchor({ screenX: 150, screenY: 0, preferBelow: true });
        app.render();

        expect(component.widget.detailsSide).toBe("left");
    });
});
