import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../src/TestUtils/expectScreen.ts";
import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import type { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { Point } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { BoxElement } from "../layout/boxElement.ts";

import { OverlayLayer } from "./overlayLayer.ts";

function renderLayer(
    layerWidth: number,
    layerHeight: number,
    setup: (layer: OverlayLayer) => void,
): MockTerminalBackend {
    const layer = new OverlayLayer();
    setup(layer);
    return renderElement(layer, layerWidth, layerHeight);
}

describe("OverlayLayer", () => {
    it("renders nothing when no items", () => {
        const backend = renderLayer(10, 3, () => {
            // noop
        });
        const screenStr = backend.screenToString();
        // All spaces
        expect(screenStr.includes("+")).toBe(false);
        expect(screenStr.includes("-")).toBe(false);
    });

    it("does not render invisible items", () => {
        const backend = renderLayer(10, 5, (layer) => {
            const box = new BoxElement();
            layer.addItem(box, new Point(0, 0), false);
        });
        // All spaces — box is invisible
        const screenStr = backend.screenToString();
        expect(screenStr.includes("+")).toBe(false);
    });

    it("renders visible item at specified position", () => {
        const backend = renderLayer(80, 24, (layer) => {
            const box = new BoxElement();
            layer.addItem(box, new Point(2, 1), true);
        });
        const screenStr = backend.screenToString();
        const lines = screenStr.split("\n");
        // Box top-left corner at column 2, row 1
        expect(lines[1][2]).toBe("+");
        // Row 0 should be blank at col 2 (box doesn't start until row 1)
        expect(lines[0][2]).toBe(" ");
    });

    it("клипует рисование ребёнка по его layoutSize (инвариант отрисовки Н2)", () => {
        // Виджет, рисующий за пределами своего размера: строку длиннее ширины.
        class SpillingElement extends BoxElement {
            public override render(context: Parameters<BoxElement["render"]>[0]): void {
                context.drawText(0, 0, "XXXXXXXXXX"); // 10 колонок
            }
        }
        const backend = renderLayer(12, 3, (layer) => {
            // Позиция x=8 в слое шириной 12 → loose-остаток даёт ширину 4.
            layer.addItem(new SpillingElement(), new Point(8, 1), true);
        });
        const lines = backend.screenToString().split("\n");
        // Нарисовано ровно 4 X (клип по layoutSize), левее позиции — пусто.
        expect(lines[1].slice(8, 12)).toBe("XXXX");
        expect(lines[1].slice(0, 8).trim()).toBe("");
    });

    it("рисует ребёнка из его localPosition после layout (Н5)", () => {
        const backend = renderLayer(80, 24, (layer) => {
            const box = new BoxElement();
            layer.addItem(box, new Point(5, 2), true);
        });
        const lines = backend.screenToString().split("\n");
        // Позиция задана через сессию, но рендер читает child.localPosition,
        // которую выставил layoutChild, — точка одна и та же.
        expect(lines[2][5]).toBe("+");
    });

    it("does not render item after making it invisible", () => {
        const layer = new OverlayLayer();
        const box = new BoxElement();
        layer.addItem(box, new Point(0, 0), true);
        layer.setVisible(box, false);

        const backend = renderElement(layer, 10, 5);

        const screenStr = backend.screenToString();
        expect(screenStr.includes("+")).toBe(false);
    });

    it("hasVisibleItems returns false when empty", () => {
        const layer = new OverlayLayer();
        expect(layer.hasVisibleItems()).toBe(false);
    });

    it("hasVisibleItems returns false when all hidden", () => {
        const layer = new OverlayLayer();
        const box = new BoxElement();
        layer.addItem(box, new Point(0, 0), false);
        expect(layer.hasVisibleItems()).toBe(false);
    });

    it("hasVisibleItems returns true when any visible", () => {
        const layer = new OverlayLayer();
        const box = new BoxElement();
        layer.addItem(box, new Point(0, 0), true);
        expect(layer.hasVisibleItems()).toBe(true);
    });

    it("dispatches events to visible item elements directly", () => {
        const layer = new OverlayLayer();
        const keys1: string[] = [];
        const keys2: string[] = [];

        const box1 = new BoxElement();
        box1.addEventListener("keydown", (e) => keys1.push(e.key));

        const box2 = new BoxElement();
        box2.addEventListener("keydown", (e) => keys2.push(e.key));

        layer.addItem(box1, new Point(0, 0), true);
        layer.addItem(box2, new Point(0, 0), false);

        box1.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(keys1).toEqual(["a"]);
        expect(keys2).toEqual([]); // invisible — not dispatched to
    });

    it("removes item", () => {
        const layer = new OverlayLayer();
        const box = new BoxElement();
        layer.addItem(box, new Point(0, 0), true);
        layer.removeItem(box);
        expect(layer.hasVisibleItems()).toBe(false);
        expect(layer.getItems().length).toBe(0);
    });

    it("clearAll removes all items", () => {
        const layer = new OverlayLayer();
        layer.addItem(new BoxElement(), new Point(0, 0), true);
        layer.addItem(new BoxElement(), new Point(5, 5), true);
        layer.clearAll();
        expect(layer.getItems().length).toBe(0);
        expect(layer.hasVisibleItems()).toBe(false);
    });
});
