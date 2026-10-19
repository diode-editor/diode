import { BoxConstraints, Offset, Size } from "@tuidom/core/common/geometryPromitives";
import { MouseEventDispatcher } from "@tuidom/core/dom/events/mouseEventDispatcher";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { SashElement } from "@tuidom/elements/sash/sashElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";

import { WorkbenchLayoutElement } from "./workbenchLayoutElement.ts";

/** Мышь в колонке/строке экрана (0-based; токен мыши — 1-based). */
function mouse(action: MouseToken["action"], x: number, y: number): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        action,
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

/** Layout корнем дерева, по смещению `origin` на экране: так drag идёт через настоящий диспетчер мыши. */
function rooted(origin: Offset, options: { bottom?: boolean } = {}): WorkbenchLayoutElement {
    const layout = new WorkbenchLayoutElement();
    layout.setLeftPanel(new TUIElement());
    layout.setCenterContent(new TUIElement());
    layout.setLeftPanelWidth(20);
    if (options.bottom === true) {
        layout.setBottomPanel(new TUIElement());
        layout.setBottomPanelVisible(true);
        layout.setBottomPanelHeight(6);
    }
    layout.setAsRoot();
    layout.localPosition = origin;
    layout.layout(BoxConstraints.tight(new Size(80, 24)));
    return layout;
}

function sashes(layout: WorkbenchLayoutElement): SashElement[] {
    return layout.getChildren().filter((c) => c instanceof SashElement);
}

describe("WorkbenchLayoutElement: drag сашей мышью", () => {
    it("вертикальный саш сайдбара ведёт ширину по колонке курсора, с учётом смещения раскладки", () => {
        const layout = rooted(new Offset(5, 2));
        const dispatcher = new MouseEventDispatcher();
        // Саш — на колонке 5 + 20; тянем до колонки 40 → ширина 35.
        dispatcher.handleMouseToken(mouse("press", 25, 10), layout);
        dispatcher.handleMouseToken(mouse("move", 40, 3), layout);
        dispatcher.handleMouseToken(mouse("release", 40, 3), layout);
        expect(layout.getLeftPanelWidth()).toBe(35);
    });

    it("горизонтальный саш панели ведёт высоту по строке курсора", () => {
        const layout = rooted(new Offset(0, 1), { bottom: true });
        const dispatcher = new MouseEventDispatcher();
        // Низ панели — строка 1 + 24; верх панели высотой 6 — строка 19.
        dispatcher.handleMouseToken(mouse("press", 40, 19), layout);
        dispatcher.handleMouseToken(mouse("move", 70, 15), layout);
        dispatcher.handleMouseToken(mouse("release", 70, 15), layout);
        expect(layout.getBottomPanelHeight()).toBe(10);
    });

    // Флаг кадра (`needsRepaint`) снимает только настоящий кадр, а layout-грязь
    // гасит и сам хит-тест мыши — поэтому заказ перерисовки виден лишь так.
    it.each([
        ["сайдбара", 20, 12, 40, 12],
        ["панели", 40, 18, 40, 10],
    ])("drag саша %s заказывает кадр", (_name, pressX, pressY, moveX, moveY) => {
        const layout = new WorkbenchLayoutElement();
        layout.setLeftPanel(new TUIElement());
        layout.setCenterContent(new TUIElement());
        layout.setLeftPanelWidth(20);
        layout.setBottomPanel(new TUIElement());
        layout.setBottomPanelVisible(true);
        layout.setBottomPanelHeight(6);
        const app = TestApp.createWithContent(layout, new Size(80, 24));
        app.render();
        expect(layout.needsRepaint).toBe(false);
        const dispatcher = new MouseEventDispatcher();
        dispatcher.handleMouseToken(mouse("press", pressX, pressY), app.root);
        dispatcher.handleMouseToken(mouse("move", moveX, moveY), app.root);
        expect(layout.needsRepaint).toBe(true);
    });
});

describe("WorkbenchLayoutElement: перерисовку команды заказывают сами", () => {
    it("nudge и reset ширины помечают раскладку грязной", () => {
        const layout = rooted(new Offset(0, 0));
        expect(layout.isLayoutDirty).toBe(false);
        layout.nudgeLeftPanelWidth(3);
        expect(layout.isLayoutDirty).toBe(true);

        layout.layout(BoxConstraints.tight(new Size(80, 24)));
        layout.resetLeftPanelWidth();
        expect(layout.isLayoutDirty).toBe(true);
    });
});

describe("WorkbenchLayoutElement: скрытое не раскладывается", () => {
    it("видимая нижняя панель без элемента: саш скрыт, редактор во всю высоту", () => {
        const layout = new WorkbenchLayoutElement();
        const center = new TUIElement();
        layout.setCenterContent(center);
        layout.setBottomPanelVisible(true);
        layout.localPosition = new Offset(0, 0);
        layout.layout(BoxConstraints.tight(new Size(80, 24)));
        expect(sashes(layout).every((s) => s.hidden)).toBe(true);
        expect(center.layoutSize).toEqual(new Size(80, 24));
    });

    it("скрытая нижняя панель и её саш не получают раскладки", () => {
        const layout = new WorkbenchLayoutElement();
        const bottom = new TUIElement();
        layout.setCenterContent(new TUIElement());
        layout.setBottomPanel(bottom);
        layout.localPosition = new Offset(0, 0);
        layout.layout(BoxConstraints.tight(new Size(80, 24)));
        expect(bottom.isLayoutDirty).toBe(true);
        expect(sashes(layout).at(-1)!.isLayoutDirty).toBe(true);
    });

    it("саш скрытого сайдбара не получает раскладки", () => {
        const layout = new WorkbenchLayoutElement();
        layout.setLeftPanel(new TUIElement());
        layout.setCenterContent(new TUIElement());
        layout.setLeftPanelVisible(false);
        layout.localPosition = new Offset(0, 0);
        layout.layout(BoxConstraints.tight(new Size(80, 24)));
        expect(sashes(layout)[0].isLayoutDirty).toBe(true);
    });
});
