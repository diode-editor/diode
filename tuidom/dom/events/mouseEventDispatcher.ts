import { Point } from "../../common/geometryPromitives.ts";
import type { MouseToken } from "../../input/rawTerminalToken.ts";
import type { TUIElement } from "../tuiElement.ts";

import { contextMenuEventFromClick } from "./contextMenuEventSource.ts";
import type { TUIMouseEventInit, TUIMouseEventType, WheelDirection } from "./tuiMouseEvent.ts";
import { TUIMouseEvent } from "./tuiMouseEvent.ts";

const DOUBLE_CLICK_THRESHOLD = 300;

export class MouseEventDispatcher {
    private hoveredElement: TUIElement | null = null;
    private pressedElement: TUIElement | null = null;
    private pressedButton: "left" | "middle" | "right" | "none" | null = null;
    private lastClickTime = 0;
    private lastClickTarget: TUIElement | null = null;
    private lastClickPosition: Point | null = null;
    private lastPosition: Point | null = null;

    private now: () => number;

    public constructor(now?: () => number) {
        this.now = now ?? (() => Date.now());
    }

    public handleMouseToken(token: MouseToken, root: TUIElement): void {
        const screenX = token.x - 1;
        const screenY = token.y - 1;
        const point = new Point(screenX, screenY);
        const target = root.elementFromPoint(point);

        switch (token.action) {
            case "press":
                this.handlePress(target, token, screenX, screenY);
                break;
            case "release":
                this.handleRelease(target, token, screenX, screenY);
                break;
            case "move":
                this.handleMove(target, token, screenX, screenY);
                break;
            case "scroll-up":
            case "scroll-down":
            case "scroll-left":
            case "scroll-right":
                this.handleScroll(target, token, screenX, screenY);
                break;
        }

        this.lastPosition = point;
    }

    private handlePress(target: TUIElement | null, token: MouseToken, screenX: number, screenY: number): void {
        if (!target) return;
        this.pressedElement = target;
        this.pressedButton = token.button;
        this.dispatchOn(target, "mousedown", token, screenX, screenY);
    }

    // True while a button is held on an element that opted into pointer capture.
    private isCapturing(): boolean {
        return (
            this.pressedElement?.capturesPointer === true &&
            this.pressedButton !== null &&
            this.pressedButton !== "none"
        );
    }

    private handleRelease(target: TUIElement | null, token: MouseToken, screenX: number, screenY: number): void {
        // While capturing, the release belongs to the captor regardless of what's under the cursor.
        const effectiveTarget = this.isCapturing() ? this.pressedElement : target;
        if (!effectiveTarget) return;
        this.dispatchOn(effectiveTarget, "mouseup", token, screenX, screenY);

        if (this.pressedElement === effectiveTarget && this.pressedButton === token.button) {
            const clickEvent = new TUIMouseEvent("click", this.buildInit(effectiveTarget, token, screenX, screenY));
            effectiveTarget.dispatchEvent(clickEvent);
            const contextMenuEvent = contextMenuEventFromClick(clickEvent);
            if (contextMenuEvent) {
                effectiveTarget.dispatchEvent(contextMenuEvent);
            }

            // A double click is two clicks on the same cell, not merely on the same
            // element: clicking two different words of one editor in quick succession
            // must stay two single clicks.
            const now = this.now();
            const samePosition =
                this.lastClickPosition !== null &&
                this.lastClickPosition.x === screenX &&
                this.lastClickPosition.y === screenY;
            if (
                this.lastClickTarget === effectiveTarget &&
                samePosition &&
                now - this.lastClickTime < DOUBLE_CLICK_THRESHOLD
            ) {
                this.dispatchOn(effectiveTarget, "dblclick", token, screenX, screenY);
                this.lastClickTarget = null;
                this.lastClickPosition = null;
                this.lastClickTime = 0;
            } else {
                this.lastClickTarget = effectiveTarget;
                this.lastClickPosition = new Point(screenX, screenY);
                this.lastClickTime = now;
            }
        }

        this.pressedElement = null;
        this.pressedButton = null;
    }

    private handleMove(target: TUIElement | null, token: MouseToken, screenX: number, screenY: number): void {
        // While capturing, route moves straight to the captor and suppress enter/leave so
        // elements under the cursor (editor, tree rows) don't flicker hover state mid-drag.
        if (this.isCapturing() && this.pressedElement) {
            this.dispatchOn(this.pressedElement, "mousemove", token, screenX, screenY);
            return;
        }

        const oldHovered = this.hoveredElement;
        const newHovered = target;

        if (oldHovered !== newHovered) {
            this.dispatchEnterLeave(oldHovered, newHovered, token, screenX, screenY);
            this.hoveredElement = newHovered;
        }

        if (newHovered) {
            this.dispatchOn(newHovered, "mousemove", token, screenX, screenY);
        }
    }

    private handleScroll(target: TUIElement | null, token: MouseToken, screenX: number, screenY: number): void {
        if (!target) return;

        const directionMap: Record<string, WheelDirection> = {
            "scroll-up": "up",
            "scroll-down": "down",
            "scroll-left": "left",
            "scroll-right": "right",
        };

        const init = this.buildInit(target, token, screenX, screenY);
        init.wheelDirection = directionMap[token.action];
        const event = new TUIMouseEvent("wheel", init);
        target.dispatchEvent(event);
    }

    private dispatchEnterLeave(
        oldElement: TUIElement | null,
        newElement: TUIElement | null,
        token: MouseToken,
        screenX: number,
        screenY: number,
    ): void {
        const oldPath = oldElement ? this.getAncestorSet(oldElement) : new Set<TUIElement>();
        const newPath = newElement ? this.getAncestorSet(newElement) : new Set<TUIElement>();

        // mouseleave: from old element up to (but not including) common ancestors
        if (oldElement) {
            const leaveElements = this.getAncestorList(oldElement).filter((el) => !newPath.has(el));
            for (const el of leaveElements) {
                // hover-состояние — ДО события: слушатели mouseleave видят его
                // снятым (как в DOM). Общий предок в diff не входит — не мигает.
                el.setStyleState("hover", false);
                this.dispatchOn(el, "mouseleave", token, screenX, screenY);
            }
        }

        // mouseenter: from common ancestor down to new element
        if (newElement) {
            const enterElements = this.getAncestorList(newElement)
                .filter((el) => !oldPath.has(el))
                .reverse();
            for (const el of enterElements) {
                // hover стоит на всей цепочке target→root, как :hover в CSS.
                el.setStyleState("hover", true);
                this.dispatchOn(el, "mouseenter", token, screenX, screenY);
            }
        }
    }

    private getAncestorList(element: TUIElement): TUIElement[] {
        // Returns path from element up to root (element first, root last)
        const path: TUIElement[] = [];
        let current: TUIElement | null = element;
        while (current !== null) {
            path.push(current);
            current = current.getParent();
        }
        return path;
    }

    private getAncestorSet(element: TUIElement): Set<TUIElement> {
        return new Set(this.getAncestorList(element));
    }

    private dispatchOn(
        target: TUIElement,
        type: TUIMouseEventType,
        token: MouseToken,
        screenX: number,
        screenY: number,
    ): void {
        const init = this.buildInit(target, token, screenX, screenY);
        const event = new TUIMouseEvent(type, init);
        target.dispatchEvent(event);
    }

    private buildInit(target: TUIElement, token: MouseToken, screenX: number, screenY: number): TUIMouseEventInit {
        return {
            button: token.button,
            screenX,
            screenY,
            localX: screenX - target.globalPosition.x,
            localY: screenY - target.globalPosition.y,
            shiftKey: token.shiftKey,
            altKey: token.altKey,
            ctrlKey: token.ctrlKey,
        };
    }
}
