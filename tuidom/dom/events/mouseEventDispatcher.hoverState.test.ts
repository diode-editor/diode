import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import type { MouseToken } from "../../input/rawTerminalToken.ts";
import { TUIElement } from "../tuiElement.ts";

import { MouseEventDispatcher } from "./mouseEventDispatcher.ts";

// ─── Helpers ───

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

function layoutElement(el: TUIElement, globalPos: Point, size: Size): void {
    const base = el.getParent()?.globalPosition ?? new Point(0, 0);
    el.localPosition = new Offset(globalPos.x - base.x, globalPos.y - base.y);
    el.layout(BoxConstraints.tight(size));
}

function moveToken(x: number, y: number): MouseToken {
    return {
        kind: "mouse",
        button: "none",
        action: "move",
        x: x + 1, // токены терминала 1-based
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

/** root(80×24) → panel(10,5 40×10) → { left(10,5 10×10), right(30,5 10×10) } */
function makeTree(): {
    root: ContainerElement;
    panel: ContainerElement;
    left: TUIElement;
    right: TUIElement;
    dispatcher: MouseEventDispatcher;
} {
    const root = new ContainerElement();
    root.setAsRoot();
    layoutElement(root, new Point(0, 0), new Size(80, 24));
    const panel = new ContainerElement();
    root.addChild(panel);
    layoutElement(panel, new Point(10, 5), new Size(40, 10));
    const left = new TUIElement();
    panel.addChild(left);
    layoutElement(left, new Point(10, 5), new Size(10, 10));
    const right = new TUIElement();
    panel.addChild(right);
    layoutElement(right, new Point(30, 5), new Size(10, 10));
    return { root, panel, left, right, dispatcher: new MouseEventDispatcher() };
}

// ─── Tests ───

describe("MouseEventDispatcher — hover-состояние стиля", () => {
    it("hover стоит на всей цепочке target→root, как :hover в CSS", () => {
        const { root, panel, left, right, dispatcher } = makeTree();

        dispatcher.handleMouseToken(moveToken(12, 7), root);

        expect(left.hasStyleState("hover")).toBe(true);
        expect(panel.hasStyleState("hover")).toBe(true);
        expect(root.hasStyleState("hover")).toBe(true);
        expect(right.hasStyleState("hover")).toBe(false);
    });

    it("переход между сиблингами: снят с ушедшей ветки, общий предок не мигает", () => {
        const { root, panel, left, right, dispatcher } = makeTree();

        dispatcher.handleMouseToken(moveToken(12, 7), root);

        let panelHoverChanges = 0;
        const origSet = panel.setStyleState.bind(panel);
        panel.setStyleState = (state, active): void => {
            if (state === "hover") panelHoverChanges++;
            origSet(state, active);
        };

        dispatcher.handleMouseToken(moveToken(32, 7), root);

        expect(left.hasStyleState("hover")).toBe(false);
        expect(right.hasStyleState("hover")).toBe(true);
        expect(panel.hasStyleState("hover")).toBe(true);
        // Общий предок не входит в diff enter/leave — его hover не трогали.
        expect(panelHoverChanges).toBe(0);
    });

    it("уход в никуда (мимо всех элементов) снимает hover со всей цепочки", () => {
        const { root, panel, left, dispatcher } = makeTree();
        // hitTestSelf у root вернёт root даже на пустом месте — уходим за экран
        dispatcher.handleMouseToken(moveToken(12, 7), root);
        expect(left.hasStyleState("hover")).toBe(true);

        dispatcher.handleMouseToken(moveToken(100, 30), root);
        expect(left.hasStyleState("hover")).toBe(false);
        expect(panel.hasStyleState("hover")).toBe(false);
        expect(root.hasStyleState("hover")).toBe(false);
    });

    it("состояние выставлено ДО диспатча mouseenter/mouseleave", () => {
        const { root, left, dispatcher } = makeTree();

        let hoverInsideEnter: boolean | null = null;
        left.addEventListener("mouseenter", () => {
            hoverInsideEnter = left.hasStyleState("hover");
        });
        let hoverInsideLeave: boolean | null = null;
        left.addEventListener("mouseleave", () => {
            hoverInsideLeave = left.hasStyleState("hover");
        });

        dispatcher.handleMouseToken(moveToken(12, 7), root);
        expect(hoverInsideEnter).toBe(true);

        dispatcher.handleMouseToken(moveToken(32, 7), root);
        expect(hoverInsideLeave).toBe(false);
    });

    it("при pointer capture hover заморожен на время drag", () => {
        const { root, left, right, dispatcher } = makeTree();
        left.capturesPointer = true;

        dispatcher.handleMouseToken(moveToken(12, 7), root);
        expect(left.hasStyleState("hover")).toBe(true);

        dispatcher.handleMouseToken({ ...moveToken(12, 7), action: "press", button: "left" }, root);
        dispatcher.handleMouseToken(moveToken(32, 7), root);

        // enter/leave подавлены — hover не переехал на right
        expect(left.hasStyleState("hover")).toBe(true);
        expect(right.hasStyleState("hover")).toBe(false);
    });
});
