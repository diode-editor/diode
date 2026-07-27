import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import type { MouseToken } from "../../input/rawTerminalToken.ts";
import { TUIElement } from "../tuiElement.ts";

import { MouseEventDispatcher } from "./mouseEventDispatcher.ts";
import type { TUIMouseEvent } from "./tuiMouseEvent.ts";

class ContainerElement extends TUIElement {
    private children: TUIElement[] = [];

    public addChild(child: TUIElement): void {
        child.setParent(this);
        this.children.push(child);
    }

    public override getChildren(): readonly TUIElement[] {
        return this.children;
    }
}

// Тесты задают позиции АБСОЛЮТНЫМИ координатами; globalPosition производный,
// поэтому пересчитываем в локальные относительно уже прикреплённого родителя.
function layoutElement(el: TUIElement, globalPos: Point, size: Size): void {
    const base = el.getParent()?.globalPosition ?? new Point(0, 0);
    el.localPosition = new Offset(globalPos.x - base.x, globalPos.y - base.y);
    el.performLayout(BoxConstraints.tight(size));
}

function makeToken(overrides: Partial<MouseToken> & { action: MouseToken["action"] }): MouseToken {
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

function collected(el: TUIElement, type: string): TUIMouseEvent[] {
    const events: TUIMouseEvent[] = [];
    el.addEventListener(type, (e) => {
        events.push(e as TUIMouseEvent);
    });
    return events;
}

/**
 * Scene: a 1-column captor at x=10 (opting into pointer capture) and a wide sibling
 * starting at x=11 (think editor next to the sidebar sash).
 */
function buildScene(captures: boolean): { root: ContainerElement; captor: TUIElement; sibling: TUIElement } {
    const root = new ContainerElement();
    root.setAsRoot();
    layoutElement(root, new Point(0, 0), new Size(80, 24));

    const captor = new TUIElement();
    captor.capturesPointer = captures;
    root.addChild(captor);
    layoutElement(captor, new Point(10, 0), new Size(1, 24));

    const sibling = new TUIElement();
    root.addChild(sibling);
    layoutElement(sibling, new Point(11, 0), new Size(40, 24));

    return { root, captor, sibling };
}

describe("MouseEventDispatcher — pointer capture", () => {
    it("routes mousemove to the captor while the cursor is over a sibling", () => {
        const { root, captor, sibling } = buildScene(true);
        const captorMoves = collected(captor, "mousemove");
        const siblingMoves = collected(sibling, "mousemove");
        const dispatcher = new MouseEventDispatcher();

        // Press on the captor (screenX 10), then drag right over the sibling (screenX 20).
        dispatcher.handleMouseToken(makeToken({ action: "press", x: 11, y: 1 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 21, y: 1 }), root);

        expect(captorMoves).toHaveLength(1);
        expect(captorMoves[0].screenX).toBe(20);
        // localX is recomputed relative to the captor's own origin (20 - 10).
        expect(captorMoves[0].localX).toBe(10);
        expect(siblingMoves).toHaveLength(0);
    });

    it("does not fire mouseenter on the sibling during a captured drag", () => {
        const { root, sibling } = buildScene(true);
        const siblingEnters = collected(sibling, "mouseenter");
        const dispatcher = new MouseEventDispatcher();

        dispatcher.handleMouseToken(makeToken({ action: "press", x: 11, y: 1 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 21, y: 1 }), root);

        expect(siblingEnters).toHaveLength(0);
    });

    it("routes mouseup (and click) to the captor when released over a sibling", () => {
        const { root, captor, sibling } = buildScene(true);
        const captorUps = collected(captor, "mouseup");
        const captorClicks = collected(captor, "click");
        const siblingUps = collected(sibling, "mouseup");
        const dispatcher = new MouseEventDispatcher();

        dispatcher.handleMouseToken(makeToken({ action: "press", x: 11, y: 1 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 21, y: 1 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "release", x: 21, y: 1 }), root);

        expect(captorUps).toHaveLength(1);
        expect(captorClicks).toHaveLength(1);
        expect(siblingUps).toHaveLength(0);
    });

    it("leaves default routing intact for elements that do not capture", () => {
        const { root, captor, sibling } = buildScene(false);
        const captorMoves = collected(captor, "mousemove");
        const siblingMoves = collected(sibling, "mousemove");
        const siblingEnters = collected(sibling, "mouseenter");
        const dispatcher = new MouseEventDispatcher();

        dispatcher.handleMouseToken(makeToken({ action: "press", x: 11, y: 1 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 21, y: 1 }), root);

        // Without capture, the move (and enter) go to whatever is under the cursor.
        expect(siblingMoves).toHaveLength(1);
        expect(siblingEnters).toHaveLength(1);
        expect(captorMoves).toHaveLength(0);
    });
});
