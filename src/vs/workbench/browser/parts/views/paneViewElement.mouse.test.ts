import { describe, expect, it, vi } from "vitest";

import { Point, Size } from "@tuidom/all/common/geometryPromitives";
import { FillerElement } from "@tuidom/all/ui/layout/fillerElement";
import type { MouseToken } from "@tuidom/all/input/rawTerminalToken";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { PaneViewElement } from "./paneViewElement.ts";

function makeHarness(): {
    app: TestApp;
    view: PaneViewElement;
    menuRequests: [string, { screenX: number; screenY: number }][];
    stateChanges: () => number;
    headerPos: (id: string) => { x: number; y: number };
} {
    const view = new PaneViewElement();
    for (const id of ["a", "b"]) {
        const body = new FillerElement();
        body.id = `${id}-body`;
        view.addPane({ id, title: id.toUpperCase(), body });
    }
    const menuRequests: [string, { screenX: number; screenY: number }][] = [];
    view.onDidRequestPaneMenu = (paneId, anchor) => menuRequests.push([paneId, anchor]);
    let changes = 0;
    view.onDidChangeState = () => changes++;

    const app = TestApp.createWithContent(view, new Size(30, 22));
    const headerPos = (id: string): { x: number; y: number } => {
        const header = app.querySelector(`#paneHeader-${id}`)!;
        return { x: header.globalPosition.x, y: header.globalPosition.y };
    };
    return { app, view, menuRequests, stateChanges: () => changes, headerPos };
}

function token(overrides: Partial<MouseToken> & { action: MouseToken["action"] }): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        x: 1,
        y: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        ...overrides,
    };
}

/** Полный клик: press + release в одной ячейке (координаты 0-based экрана). */
function click(app: TestApp, x: number, y: number, button: "left" | "right" = "left"): void {
    app.backend.simulateMouse(token({ action: "press", button, x: x + 1, y: y + 1 }));
    app.backend.simulateMouse(token({ action: "release", button, x: x + 1, y: y + 1 }));
}

function drag(app: TestApp, x: number, fromY: number, toY: number): void {
    app.backend.simulateMouse(token({ action: "press", x: x + 1, y: fromY + 1 }));
    app.backend.simulateMouse(token({ action: "move", x: x + 1, y: toY + 1 }));
    app.backend.simulateMouse(token({ action: "release", x: x + 1, y: toY + 1 }));
}

function bodyHeights(view: PaneViewElement): Record<string, number> {
    const state = view.inspectState() as { panes: { id: string; bodyHeight: number }[] };
    return Object.fromEntries(state.panes.map((p) => [p.id, p.bodyHeight]));
}

describe("PaneViewElement mouse", () => {
    it("клик по заголовку сворачивает и разворачивает секцию", () => {
        const { app, view, stateChanges, headerPos } = makeHarness();
        const pos = headerPos("b");
        click(app, pos.x + 2, pos.y);
        expect(view.isCollapsed("b")).toBe(true);
        expect(stateChanges()).toBe(1);
        click(app, pos.x + 2, headerPos("b").y);
        expect(view.isCollapsed("b")).toBe(false);
        expect(stateChanges()).toBe(2);
    });

    it("клик по кнопке ⋯ открывает меню и не сворачивает секцию", () => {
        const { app, view, menuRequests, headerPos } = makeHarness();
        const pos = headerPos("a");
        const menuX = pos.x + 28; // «⋯» — правые 3 колонки заголовка шириной 30
        click(app, menuX, pos.y);
        expect(menuRequests).toEqual([["a", { screenX: menuX, screenY: pos.y }]]);
        expect(view.isCollapsed("a")).toBe(false);
    });

    it("правый клик по заголовку открывает меню с якорем в точке клика", () => {
        const { app, menuRequests, headerPos } = makeHarness();
        const pos = headerPos("b");
        click(app, pos.x + 4, pos.y, "right");
        expect(menuRequests).toEqual([["b", { screenX: pos.x + 4, screenY: pos.y }]]);
    });

    it("drag заголовка перекидывает строки между секциями и не сворачивает", () => {
        const { app, view, stateChanges, headerPos } = makeHarness();
        const before = bodyHeights(view); // 10/10 при высоте 22
        const pos = headerPos("b");
        drag(app, pos.x + 2, pos.y, pos.y - 3);
        app.render();
        expect(bodyHeights(view)).toEqual({ a: before.a - 3, b: before.b + 3 });
        expect(view.isCollapsed("b")).toBe(false);
        expect(stateChanges()).toBe(1);
    });

    it("drag клампится минимальной высотой соседней секции", () => {
        const { app, view, headerPos } = makeHarness();
        const pos = headerPos("b");
        drag(app, pos.x + 2, pos.y, pos.y - 15); // выше минимума секции a
        app.render();
        expect(bodyHeights(view)).toEqual({ a: 3, b: 17 });
    });

    it("drag верхнего заголовка (нет развёрнутых выше) ничего не меняет и не сворачивает", () => {
        const { app, view, stateChanges, headerPos } = makeHarness();
        const before = bodyHeights(view);
        const pos = headerPos("a");
        drag(app, pos.x + 2, pos.y, pos.y + 4);
        app.render();
        expect(bodyHeights(view)).toEqual(before);
        expect(view.isCollapsed("a")).toBe(false);
        expect(stateChanges()).toBe(0);
    });

    it("после drag веса замораживаются — повторный layout воспроизводит высоты", () => {
        const { app, view, headerPos } = makeHarness();
        const pos = headerPos("b");
        drag(app, pos.x + 2, pos.y, pos.y - 2);
        app.render();
        const after = bodyHeights(view);
        app.render();
        expect(bodyHeights(view)).toEqual(after);
        expect(view.getWeights()).toEqual({ a: after.a, b: after.b });
    });

    it("mousemove без зажатой кнопки не считается drag'ом", () => {
        const { app, view, headerPos } = makeHarness();
        const before = bodyHeights(view);
        const pos = headerPos("b");
        app.backend.simulateMouse(token({ action: "move", x: pos.x + 3, y: pos.y + 1 }));
        app.render();
        expect(bodyHeights(view)).toEqual(before);
    });

    it("делегация: preventDefault на mouseup (capture-фаза предка) гасит toggle", () => {
        const { app, view, headerPos } = makeHarness();
        view.addEventListener("mouseup", (e) => e.preventDefault(), { capture: true });
        const pos = headerPos("a");
        click(app, pos.x + 2, pos.y);
        expect(view.isCollapsed("a")).toBe(false);
    });

    it("drag, зажатый до сворачивания соседа, дальше игнорируется (защита от гонки capture)", () => {
        const { app, view, stateChanges } = makeHarness();
        // Симуляция: capture ещё держит заголовок b, но развёрнутых ниже уже нет.
        view.setCollapsed("b", true);
        app.render();
        const headerB = app.querySelector("#paneHeader-b")!;
        const before = bodyHeights(view);
        (headerB as { onDrag?: (y: number) => void }).onDrag?.(headerB.globalPosition.y - 2);
        app.render();
        expect(bodyHeights(view)).toEqual(before);
        expect(stateChanges()).toBe(0);
    });

    it("drag в собственную строку границы — no-op", () => {
        const { app, view, stateChanges } = makeHarness();
        const headerB = app.querySelector("#paneHeader-b")!;
        (headerB as { onDrag?: (y: number) => void }).onDrag?.(headerB.globalPosition.y);
        app.render();
        expect(stateChanges()).toBe(0);
        expect(view.getWeights()).toEqual({ a: 1, b: 1 });
    });

    it("drag за пределы минимума после клампа — no-op без события", () => {
        const { app, view, stateChanges, headerPos } = makeHarness();
        const pos = headerPos("b");
        drag(app, pos.x + 2, pos.y, pos.y - 15); // кламп: a=3
        app.render();
        expect(stateChanges()).toBe(1);
        const headerB = app.querySelector("#paneHeader-b")!;
        (headerB as { onDrag?: (y: number) => void }).onDrag?.(headerB.globalPosition.y - 5);
        app.render();
        expect(bodyHeights(view)).toEqual({ a: 3, b: 17 });
        expect(stateChanges()).toBe(1);
    });

    it("двум секциям тесно (сумма меньше минимумов) — граница не двигается", () => {
        const view = new PaneViewElement();
        for (const id of ["a", "b"]) {
            const body = new FillerElement();
            body.id = `${id}-body`;
            view.addPane({ id, title: id.toUpperCase(), body });
        }
        let changes = 0;
        view.onDidChangeState = () => changes++;
        const app = TestApp.createWithContent(view, new Size(30, 7)); // тела 3 и 2 < 3+3
        const headerB = app.querySelector("#paneHeader-b")!;
        (headerB as { onDrag?: (y: number) => void }).onDrag?.(headerB.globalPosition.y - 1);
        app.render();
        expect(bodyHeights(view)).toEqual({ a: 3, b: 2 });
        expect(changes).toBe(0);
    });

    it("свёрнутая секция не участвует в заморозке весов при drag", () => {
        const view = new PaneViewElement();
        for (const id of ["a", "b", "c"]) {
            const body = new FillerElement();
            body.id = `${id}-body`;
            view.addPane({ id, title: id.toUpperCase(), body });
        }
        view.setCollapsed("c", true);
        const app = TestApp.createWithContent(view, new Size(30, 22));
        const headerB = app.querySelector("#paneHeader-b")!;
        (headerB as { onDrag?: (y: number) => void }).onDrag?.(headerB.globalPosition.y - 2);
        app.render();
        const weights = view.getWeights();
        expect(weights.c).toBe(1); // вес свёрнутой не тронут
        expect(weights.a + weights.b).toBe(19); // фактические высоты развёрнутых (22 − 3 заголовка)
    });

    it("клик по inline-кнопке заголовка репортится наверх с id секции", () => {
        const { app, view, headerPos } = makeHarness();
        const actions: [string, string][] = [];
        view.onDidRequestPaneAction = (paneId, actionId) => actions.push([paneId, actionId]);
        view.setPaneActions("a", [{ id: "cmd.refresh", icon: "R" }]);
        app.render();

        // Кнопка — 3 колонки левее «⋯» у правого края (ширина 30).
        const pos = headerPos("a");
        const x = pos.x + 30 - 3 - 2;
        app.backend.simulateMouse(token({ action: "press", x: x + 1, y: pos.y + 1 }));
        app.backend.simulateMouse(token({ action: "release", x: x + 1, y: pos.y + 1 }));
        expect(actions).toEqual([["a", "cmd.refresh"]]);
    });

    it("наведение подсвечивает кнопку под курсором, уход — гасит", () => {
        const { app, view, headerPos } = makeHarness();
        view.setPaneActions("a", [{ id: "cmd.refresh", icon: "R" }]);
        app.render();
        const pos = headerPos("a");
        // Кнопка — 3 колонки у правого края (ширина 30), «⋯» левее неё нет:
        // у секции стенда меню пустое.
        const buttonX = pos.x + 30 - 2;
        const restBg = app.backend.getBgAt(new Point(buttonX, pos.y));

        app.backend.simulateMouse(token({ action: "move", x: buttonX + 1, y: pos.y + 1 }));
        app.render();
        const hoverBg = app.backend.getBgAt(new Point(buttonX, pos.y));
        expect(hoverBg).not.toBe(restBg);

        // Курсор ушёл на название — подсветка снялась.
        app.backend.simulateMouse(token({ action: "move", x: pos.x + 3, y: pos.y + 1 }));
        app.render();
        expect(app.backend.getBgAt(new Point(buttonX, pos.y))).toBe(restBg);

        // ...и то же самое, когда курсор уходит с заголовка совсем (mouseleave).
        app.backend.simulateMouse(token({ action: "move", x: buttonX + 1, y: pos.y + 1 }));
        app.render();
        expect(app.backend.getBgAt(new Point(buttonX, pos.y))).not.toBe(restBg);
        app.backend.simulateMouse(token({ action: "move", x: buttonX + 1, y: pos.y + 3 }));
        app.render();
        expect(app.backend.getBgAt(new Point(buttonX, pos.y))).toBe(restBg);
    });

    it("дети заголовка презентационные — хит-тест отдаёт заголовок", () => {
        const { app, headerPos } = makeHarness();
        const pos = headerPos("a");
        const spy = vi.fn();
        const header = app.querySelector("#paneHeader-a")!;
        header.addEventListener("mousedown", spy);
        app.backend.simulateMouse(token({ action: "press", x: pos.x + 2, y: pos.y + 1 }));
        app.backend.simulateMouse(token({ action: "release", x: pos.x + 2, y: pos.y + 1 }));
        expect(spy).toHaveBeenCalledOnce();
    });
});
