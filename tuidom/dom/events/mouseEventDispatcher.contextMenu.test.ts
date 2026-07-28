import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import type { MouseToken } from "../../input/rawTerminalToken.ts";
import { TUIElement } from "../tuiElement.ts";

import { MouseEventDispatcher } from "./mouseEventDispatcher.ts";
import type { TUIContextMenuEvent } from "./tuiMouseEvent.ts";

// ─── Helpers ───

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

// Тесты задают позиции АБСОЛЮТНЫМИ координатами; globalPosition производный,
// поэтому пересчитываем в локальные относительно уже прикреплённого родителя.
function layoutElement(el: TUIElement, globalPos: Point, size: Size): void {
    const base = el.getParent()?.globalPosition ?? new Point(0, 0);
    el.localPosition = new Offset(globalPos.x - base.x, globalPos.y - base.y);
    el.layout(BoxConstraints.tight(size));
}

function makeToken(overrides: Partial<MouseToken> & { action: MouseToken["action"] }): MouseToken {
    return {
        kind: "mouse",
        button: "right",
        x: 1,
        y: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        ...overrides,
    };
}

function setup(): { dispatcher: MouseEventDispatcher; root: ContainerElement; child: TUIElement; log: string[] } {
    const root = new ContainerElement();
    root.setAsRoot();
    layoutElement(root, new Point(0, 0), new Size(80, 24));

    const child = new TUIElement();
    root.addChild(child);
    layoutElement(child, new Point(10, 5), new Size(20, 10));

    const log: string[] = [];
    for (const type of ["mousedown", "mouseup", "click", "contextmenu"]) {
        child.addEventListener(type, () => log.push(type));
    }

    return { dispatcher: new MouseEventDispatcher(), root, child, log };
}

// ─── Tests ───

describe("MouseEventDispatcher — contextmenu", () => {
    it("dispatches contextmenu after click on right press+release", () => {
        const { dispatcher, root, child, log } = setup();
        let received: TUIContextMenuEvent | null = null;
        child.addEventListener("contextmenu", (e) => {
            received = e as TUIContextMenuEvent;
        });

        dispatcher.handleMouseToken(makeToken({ action: "press", x: 15, y: 8 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "release", x: 15, y: 8 }), root);

        expect(log).toEqual(["mousedown", "mouseup", "click", "contextmenu"]);
        expect(received).not.toBeNull();
        expect(received).toMatchObject({
            trigger: "mouse",
            button: "right",
            screenX: 14,
            screenY: 7,
            localX: 4,
            localY: 2,
        });
    });

    it("does not dispatch contextmenu for the left button", () => {
        const { dispatcher, root, log } = setup();

        dispatcher.handleMouseToken(makeToken({ action: "press", button: "left", x: 15, y: 8 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "release", button: "left", x: 15, y: 8 }), root);

        expect(log).toEqual(["mousedown", "mouseup", "click"]);
    });

    it("does not dispatch contextmenu when the release lands on another element", () => {
        const { dispatcher, root, log } = setup();
        const rootContextMenus: string[] = [];
        root.addEventListener("contextmenu", () => rootContextMenus.push("root"));

        dispatcher.handleMouseToken(makeToken({ action: "press", x: 15, y: 8 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "release", x: 50, y: 20 }), root);

        // mouseup ушёл элементу под курсором (root), click/contextmenu не было нигде.
        expect(log).toEqual(["mousedown"]);
        expect(rootContextMenus).toEqual([]);
    });

    it("bubbles contextmenu up to ancestors", () => {
        const { dispatcher, root } = setup();
        const bubbled: string[] = [];
        root.addEventListener("contextmenu", () => bubbled.push("root"));

        dispatcher.handleMouseToken(makeToken({ action: "press", x: 15, y: 8 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "release", x: 15, y: 8 }), root);

        expect(bubbled).toEqual(["root"]);
    });
});
