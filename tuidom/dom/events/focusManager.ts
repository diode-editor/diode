import type { TUIElement } from "../tuiElement.ts";

import { TUIFocusEvent } from "./tuiFocusEvent.ts";

export class FocusManager {
    public activeElement: TUIElement | null = null;
    private rootElement: TUIElement;
    private focusScopeStack: TUIElement[] = [];

    public constructor(rootElement: TUIElement) {
        this.rootElement = rootElement;
    }

    /** Ограничить Tab-навигацию поддеревом `element` (модальные оверлеи). */
    public pushFocusScope(element: TUIElement): void {
        this.focusScopeStack.push(element);
    }

    /** Снять ранее установленный focus-scope. Удаляет по идентичности — устойчиво к не-LIFO снятию. */
    public popFocusScope(element: TUIElement): void {
        const index = this.focusScopeStack.lastIndexOf(element);
        if (index !== -1) {
            this.focusScopeStack.splice(index, 1);
        }
    }

    public setFocus(element: TUIElement | null): void {
        if (element === this.activeElement) return;

        const oldElement = this.activeElement;

        if (oldElement) {
            // Состояние стиля — ДО события: blur-слушатели видят его снятым.
            oldElement.setStyleState("focus", false);
            const blurEvent = new TUIFocusEvent("blur", element);
            this.activeElement = null;
            oldElement.dispatchEvent(blurEvent);
        }

        this.activeElement = element;

        if (element) {
            // Только target (как :focus в CSS); потомкам доступен селектор
            // "in:focus", предок при нужде слушает focus/blur в bubble-фазе.
            element.setStyleState("focus", true);
            const focusEvent = new TUIFocusEvent("focus", oldElement);
            element.dispatchEvent(focusEvent);
        }
    }

    public cycleFocus(direction: "forward" | "backward"): void {
        const scope = this.focusScopeStack[this.focusScopeStack.length - 1] ?? this.rootElement;
        const focusable = scope.getDepthFirstFocusableOrder();
        if (focusable.length === 0) return;

        const currentIndex = this.activeElement ? focusable.indexOf(this.activeElement) : -1;

        let nextIndex: number;
        if (direction === "forward") {
            nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % focusable.length;
        } else {
            nextIndex =
                currentIndex === -1 ? focusable.length - 1 : (currentIndex - 1 + focusable.length) % focusable.length;
        }

        this.setFocus(focusable[nextIndex]);
    }
}
