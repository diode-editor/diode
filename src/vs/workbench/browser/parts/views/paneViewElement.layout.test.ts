import { describe, expect, it } from "vitest";

import { BoxConstraints, Point, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { PaneViewElement } from "./paneViewElement.ts";

interface IPaneSpec {
    readonly id: string;
    readonly minBodyHeight?: number;
}

function makeView(specs: readonly IPaneSpec[]): { view: PaneViewElement; bodies: Map<string, TUIElement> } {
    const view = new PaneViewElement();
    const bodies = new Map<string, TUIElement>();
    for (const spec of specs) {
        const body = new FillerElement();
        body.id = `${spec.id}-body`;
        bodies.set(spec.id, body);
        view.addPane({ id: spec.id, title: spec.id.toUpperCase(), body, minBodyHeight: spec.minBodyHeight });
    }
    return { view, bodies };
}

function layout(view: PaneViewElement, width: number, height: number): void {
    view.layout(BoxConstraints.tight(new Size(width, height)));
}

function bodyHeights(view: PaneViewElement): Record<string, number> {
    const state = view.inspectState() as { panes: { id: string; bodyHeight: number }[] };
    return Object.fromEntries(state.panes.map((p) => [p.id, p.bodyHeight]));
}

describe("PaneViewElement layout", () => {
    it("делит остаток поровну между развёрнутыми секциями при равных весах", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        layout(view, 30, 20); // 2 заголовка → остаток 18
        expect(bodyHeights(view)).toEqual({ a: 9, b: 9 });
    });

    it("веса задают пропорции", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        view.setWeights({ a: 2, b: 1 });
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual({ a: 12, b: 6 });
    });

    it("largest remainder детерминирован: остаток уходит ранним секциям", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }, { id: "c" }]);
        layout(view, 30, 20); // 3 заголовка → остаток 17 = 6 + 6 + 5
        expect(bodyHeights(view)).toEqual({ a: 6, b: 6, c: 5 });
    });

    it("свёрнутая секция — только заголовок, остаток достаётся развёрнутой", () => {
        const { view, bodies } = makeView([{ id: "a" }, { id: "b" }]);
        view.setCollapsed("b", true);
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual({ a: 18, b: 0 });
        expect(bodies.get("b")!.hidden).toBe(true);
        expect(view.isCollapsed("b")).toBe(true);
    });

    it("все секции свёрнуты — заголовки стопкой сверху", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        view.setCollapsed("a", true);
        view.setCollapsed("b", true);
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual({ a: 0, b: 0 });
        const headerB = view.querySelector("#paneHeader-b")!;
        expect(headerB.localPosition.dy).toBe(1);
    });

    it("min-высота поднимает долю тесной секции, хвост клипуется", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }, { id: "c" }]);
        layout(view, 30, 10); // остаток 7, min 3: доли 3/2/2 → desired 3/3/3 → 3/3/1
        expect(bodyHeights(view)).toEqual({ a: 3, b: 3, c: 1 });
    });

    it("высоты не хватает даже на заголовки — хвостовые клипуются в ноль", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }, { id: "c" }]);
        layout(view, 30, 2);
        expect(bodyHeights(view)).toEqual({ a: 0, b: 0, c: 0 });
        const headerC = view.querySelector("#paneHeader-c")!;
        expect(headerC.layoutSize.height).toBe(0);
    });

    it("повторный layout при неизменном состоянии воспроизводит те же высоты", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }, { id: "c" }]);
        view.setWeights({ a: 7, b: 5, c: 5 });
        layout(view, 30, 20);
        const first = bodyHeights(view);
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual(first);
    });

    it("setWeights игнорирует незнакомые id и мусорные значения", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        view.setWeights({ a: 2, ghost: 5, b: Number.NaN });
        layout(view, 30, 20);
        expect(view.getWeights()).toEqual({ a: 2, b: 1 });
        expect(bodyHeights(view)).toEqual({ a: 12, b: 6 });
    });

    it("единственная развёрнутая секция получает весь остаток независимо от весов", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        view.setWeights({ a: 1, b: 100 });
        view.setCollapsed("b", true);
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual({ a: 18, b: 0 });
    });

    it("addPane с повторным id бросает, removePane убирает секцию", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        expect(() => view.addPane({ id: "a", title: "A", body: new FillerElement() })).toThrow(/duplicate pane id/);
        view.removePane("ghost"); // незнакомый id — тихий no-op
        view.removePane("b");
        expect(view.getPaneIds()).toEqual(["a"]);
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual({ a: 19 });
    });

    it("заголовок рисует шеврон, название и кнопку ⋯", () => {
        const { view } = makeView([{ id: "changes" }]);
        const backend = renderElement(view, 30, 6, { themeVars: true });
        const headerRow = backend.getTextAt(new Point(0, 0), 30);
        expect(headerRow).toContain("CHANGES");
        expect(headerRow).toContain("⋯");
    });

    it("программный setCollapsed не дёргает onDidChangeState, toggle — дёргает", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        let notified = 0;
        view.onDidChangeState = () => notified++;
        view.setCollapsed("a", true);
        expect(notified).toBe(0);
        view.toggleCollapsed("a");
        expect(notified).toBe(1);
        expect(view.isCollapsed("a")).toBe(false);
    });

    it("неизвестный id — ошибка", () => {
        const { view } = makeView([{ id: "a" }]);
        expect(() => view.isCollapsed("ghost")).toThrow(/unknown pane id/);
    });
});
