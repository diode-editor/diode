import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import type { PaneHeaderElement } from "./paneHeaderElement.ts";
import { PaneViewElement } from "./paneViewElement.ts";

function makeHarness(): {
    app: TestApp;
    view: PaneViewElement;
    bodies: Map<string, FillerElement>;
    menuRequests: [string, { screenX: number; screenY: number }][];
} {
    const view = new PaneViewElement();
    const bodies = new Map<string, FillerElement>();
    for (const id of ["a", "b"]) {
        const body = new FillerElement();
        body.id = `${id}-body`;
        bodies.set(id, body);
        view.addPane({ id, title: id.toUpperCase(), body });
    }
    const menuRequests: [string, { screenX: number; screenY: number }][] = [];
    view.onDidRequestPaneMenu = (paneId, anchor) => menuRequests.push([paneId, anchor]);
    const app = TestApp.createWithContent(view, new Size(30, 22));
    return { app, view, bodies, menuRequests };
}

describe("PaneViewElement keyboard", () => {
    it("Enter на сфокусированном заголовке сворачивает, Space разворачивает", () => {
        const { app, view } = makeHarness();
        view.focusPane("b");
        app.sendKey("Enter");
        expect(view.isCollapsed("b")).toBe(true);
        app.sendKey(" ");
        expect(view.isCollapsed("b")).toBe(false);
    });

    it("Enter на несворачиваемой секции — no-op, toggleCollapsed не дёргает персист", () => {
        const view = new PaneViewElement();
        const body = new FillerElement();
        body.id = "solo-body";
        view.addPane({ id: "solo", title: "SOLO", body, collapsible: false });
        let stateChanges = 0;
        view.onDidChangeState = () => stateChanges++;
        const app = TestApp.createWithContent(view, new Size(30, 22));

        view.focusPane("solo");
        app.sendKey("Enter");
        expect(view.isCollapsed("solo")).toBe(false);

        view.toggleCollapsed("solo");
        expect(view.isCollapsed("solo")).toBe(false);
        expect(stateChanges).toBe(0);
    });

    it("Shift+F10 открывает меню секции с якорем у кнопки ⋯", () => {
        const { app, view, menuRequests } = makeHarness();
        view.focusPane("a");
        app.sendKey("Shift+F10");
        const header = app.querySelector("#paneHeader-a")!;
        expect(menuRequests).toEqual([
            ["a", { screenX: header.globalPosition.x + 27, screenY: header.globalPosition.y }],
        ]);
        expect(view.isCollapsed("a")).toBe(false);
    });

    it("сворачивание секции переносит фокус из её тела на заголовок", () => {
        const { app, view, bodies } = makeHarness();
        const body = bodies.get("b")!;
        body.focusable = true;
        body.focus();
        expect(app.focusedElement).toBe(body);
        view.toggleCollapsed("b");
        app.render();
        expect((app.focusedElement as PaneHeaderElement).id).toBe("paneHeader-b");
    });

    it("сворачивание чужой секции фокус не трогает", () => {
        const { app, view, bodies } = makeHarness();
        const body = bodies.get("a")!;
        body.focusable = true;
        body.focus();
        view.toggleCollapsed("b");
        app.render();
        expect(app.focusedElement).toBe(body);
    });

    it("заголовки участвуют в Tab-обходе", () => {
        const { app } = makeHarness();
        const headerA = app.querySelector("#paneHeader-a")!;
        headerA.focus();
        app.sendKey("Tab");
        expect((app.focusedElement as PaneHeaderElement).id).toBe("paneHeader-b");
    });
});
