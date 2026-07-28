import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import type { TUIEventBase } from "../../dom/events/tuiEventBase.ts";
import type { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

export interface OverlayLayerItem {
    element: TUIElement;
    position: Point;
    visible: boolean;
}

export interface OverlayAnchorPosition {
    screenX: number;
    screenY: number;
    offsetX?: number;
    offsetY?: number;
    preferBelow?: boolean;
}

/**
 * Поведение оверлей-сессии по клику мимо неё. Поле обязательное — каждый оверлей
 * должен явно объявить, что происходит с кликом позади него:
 * - `close-on-outside` — клик снаружи закрывает сессию (попап доходит до элемента позади как раньше);
 * - `modal` — клик снаружи блокируется и НЕ доходит до элементов позади (плюс Tab-фокус заперт внутри);
 * - `passthrough` — клик снаружи проходит насквозь, сессия не закрывается (док-виджеты вроде Find).
 */
export type PointerPolicy = "close-on-outside" | "modal" | "passthrough";

export interface OverlaySessionOptions {
    visible?: boolean;
    restoreFocus?: boolean;
    focusOnOpen?: boolean;
    closeOnEscape?: boolean;
    pointerPolicy: PointerPolicy;
    /** Гасит ли оверлей глобальные кейбинды, пока видим. По умолчанию pointerPolicy !== "passthrough". */
    capturesKeyboard?: boolean;
    disposeOnClose?: boolean;
    onClose?: () => void;
    /**
     * Дополнительная принадлежность цели к сессии для close-on-outside: клик по
     * элементу, за который поручился владелец (вложенные попапы-подменю — они
     * отдельные item'ы слоя, не потомки), сессию не закрывает.
     */
    ownsTarget?: (target: TUIElement) => boolean;
    /**
     * Хук перед закрытием по Escape: вернуть false, чтобы слой сессию НЕ закрывал
     * (владелец обработает Escape сам — например закроет только верхнее подменю).
     */
    shouldCloseOnEscape?: () => boolean;
}

export interface OverlaySessionHandle {
    readonly element: TUIElement;
    readonly isDisposed: boolean;
    isOpen(): boolean;
    open(): void;
    close(): void;
    setPosition(position: Point): void;
    setAnchor(anchor: OverlayAnchorPosition): void;
    dispose(): void;
}

interface OverlaySessionState {
    element: TUIElement;
    options: Required<
        Pick<
            OverlaySessionOptions,
            "restoreFocus" | "focusOnOpen" | "closeOnEscape" | "pointerPolicy" | "capturesKeyboard" | "disposeOnClose"
        >
    >;
    visible: boolean;
    isDisposed: boolean;
    savedFocus: TUIElement | null;
    focusScopePushed: boolean;
    rootEscapeHandler: ((event: TUIEventBase) => void) | null;
    rootOutsideHandler: ((event: TUIEventBase) => void) | null;
    onClose: (() => void) | null;
    ownsTarget: ((target: TUIElement) => boolean) | null;
    shouldCloseOnEscape: (() => boolean) | null;
}

export class OverlayLayer extends TUIElement {
    private items: OverlayLayerItem[] = [];
    private sessions = new Map<TUIElement, OverlaySessionState>();

    public addItem(element: TUIElement, position: Point, visible = false): void {
        this.appendChild(element);
        element.hidden = !visible;
        this.items.push({ element, position, visible });
        this.markDirty();
    }

    public removeItem(element: TUIElement): void {
        const session = this.sessions.get(element);
        if (session && !session.isDisposed) {
            this.disposeSession(session);
            return;
        }

        const index = this.items.findIndex((item) => item.element === element);
        if (index !== -1) {
            this.removeChild(this.items[index].element);
            this.items.splice(index, 1);
            this.markDirty();
        }
    }

    public setVisible(element: TUIElement, visible: boolean): void {
        const item = this.items.find((item) => item.element === element);
        if (item) {
            item.visible = visible;
            // hidden зеркалит видимость item'а: базовые обходы (Tab, hit-test)
            // пропускают закрытые сессии сами, без override'ов.
            item.element.hidden = !visible;
            this.markDirty();
        }
    }

    public setPosition(element: TUIElement, position: Point): void {
        const item = this.items.find((item) => item.element === element);
        if (item) {
            item.position = position;
            this.markDirty();
        }
    }

    public createSession(element: TUIElement, position: Point, options: OverlaySessionOptions): OverlaySessionHandle {
        this.disposeSessionByElement(element);

        const initialVisible = options.visible ?? false;

        this.addItem(element, position, false);

        const session: OverlaySessionState = {
            element,
            options: {
                restoreFocus: options.restoreFocus ?? false,
                focusOnOpen: options.focusOnOpen ?? false,
                closeOnEscape: options.closeOnEscape ?? false,
                pointerPolicy: options.pointerPolicy,
                capturesKeyboard: options.capturesKeyboard ?? options.pointerPolicy !== "passthrough",
                disposeOnClose: options.disposeOnClose ?? false,
            },
            visible: false,
            isDisposed: false,
            savedFocus: null,
            focusScopePushed: false,
            rootEscapeHandler: null,
            rootOutsideHandler: null,
            onClose: options.onClose ?? null,
            ownsTarget: options.ownsTarget ?? null,
            shouldCloseOnEscape: options.shouldCloseOnEscape ?? null,
        };

        this.sessions.set(element, session);

        if (initialVisible) {
            this.openSession(session);
        }

        const handle: OverlaySessionHandle = {
            element,
            get isDisposed() {
                return session.isDisposed;
            },
            isOpen: () => {
                return !session.isDisposed && session.visible;
            },
            open: () => {
                if (session.isDisposed) return;
                this.openSession(session);
            },
            close: () => {
                if (session.isDisposed) return;
                this.closeSession(session);
            },
            setPosition: (nextPosition: Point) => {
                if (session.isDisposed) return;
                this.setPosition(session.element, nextPosition);
            },
            setAnchor: (anchor: OverlayAnchorPosition) => {
                if (session.isDisposed) return;
                this.setPosition(session.element, this.computeAnchorPosition(session.element, anchor));
            },
            dispose: () => {
                if (session.isDisposed) return;
                this.disposeSession(session);
            },
        };

        return handle;
    }

    public openPopupSession(
        element: TUIElement,
        anchor: OverlayAnchorPosition,
        options: OverlaySessionOptions,
    ): OverlaySessionHandle {
        const position = this.computeAnchorPosition(element, anchor);
        return this.createSession(element, position, options);
    }

    public computeAnchorPosition(element: TUIElement, anchor: OverlayAnchorPosition): Point {
        const menuW = element.getMaxIntrinsicWidth(0);
        const menuH = element.getMaxIntrinsicHeight(menuW);
        const screenW = this.layoutSize.width;
        const screenH = this.layoutSize.height;

        const offsetX = anchor.offsetX ?? 0;
        const offsetY = anchor.offsetY ?? 0;
        const preferBelow = anchor.preferBelow ?? true;

        let px = anchor.screenX + offsetX;
        let py = preferBelow ? anchor.screenY + 1 + offsetY : anchor.screenY + offsetY;

        if (px + menuW > screenW) {
            px = Math.max(0, screenW - menuW);
        }
        if (py + menuH > screenH) {
            py = Math.max(0, anchor.screenY - menuH);
        }

        px = Math.max(0, px);
        py = Math.max(0, py);

        return new Point(px, py);
    }

    public hasVisibleItems(): boolean {
        return this.items.some((item) => item.visible);
    }

    /**
     * Клавиатурный аналог модальности из elementFromPoint: видимая захватывающая сессия
     * гасит ГЛОБАЛЬНЫЕ кейбинды, чтобы шорткат не увёл фокус на панель за оверлеем.
     * Собственные клавиши оверлея идут мимо глобального реестра, поэтому не задеваются.
     */
    public hasKeyboardCapturingOverlay(): boolean {
        for (const session of this.sessions.values()) {
            if (session.visible && session.options.capturesKeyboard) return true;
        }
        return false;
    }

    public clearAll(): void {
        for (const session of this.sessions.values()) {
            this.cleanupSessionListeners(session);
            this.releaseFocusScope(session);
            session.isDisposed = true;
        }
        this.sessions.clear();

        for (const item of this.items) {
            this.removeChild(item.element);
        }
        this.items = [];
        this.markDirty();
    }

    public getItems(): readonly OverlayLayerItem[] {
        return this.items;
    }

    public override elementFromPoint(point: Point): TUIElement | null {
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            if (!item.visible) continue;
            const bounds = new Rect(item.element.globalPosition, item.element.layoutSize);
            if (bounds.containsPoint(point)) {
                const hit = item.element.elementFromPoint(point);
                if (hit) return hit;
            }
            // A modal session swallows every point not already claimed by an item above it,
            // so the hit never falls through to elements behind the overlay.
            if (this.isModalElement(item.element)) {
                return item.element;
            }
        }
        return null;
    }

    private isModalElement(element: TUIElement): boolean {
        const session = this.sessions.get(element);
        return session?.visible === true && session.options.pointerPolicy === "modal";
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const layerSize = super.performLayout(constraints);

        for (const item of this.items) {
            if (!item.visible) continue;

            // Constrain child so it doesn't overflow beyond the layer bounds
            const availableWidth = Math.max(0, layerSize.width - item.position.x);
            const availableHeight = Math.max(0, layerSize.height - item.position.y);
            this.layoutChild(
                item.element,
                item.position.x,
                item.position.y,
                BoxConstraints.loose(new Size(availableWidth, availableHeight)),
            );
        }

        return layerSize;
    }

    public render(context: RenderContext): void {
        for (const item of this.items) {
            if (!item.visible) continue;

            const childOffset = new Offset(item.position.x, item.position.y);
            item.element.render(context.withOffset(childOffset));
        }
    }

    private openSession(session: OverlaySessionState): void {
        if (session.visible || session.isDisposed) return;

        const root = this.getRoot();
        const focusManager = root?.focusManager ?? null;

        if (session.options.restoreFocus) {
            session.savedFocus = focusManager?.activeElement ?? null;
        }

        session.visible = true;
        this.setVisible(session.element, true);
        this.attachSessionListeners(session);

        if (focusManager && session.options.pointerPolicy === "modal" && !session.focusScopePushed) {
            focusManager.pushFocusScope(session.element);
            session.focusScopePushed = true;
        }

        if (session.options.focusOnOpen) {
            session.element.focus();
        }
    }

    private releaseFocusScope(session: OverlaySessionState): void {
        if (!session.focusScopePushed) return;
        const focusManager = this.getRoot()?.focusManager ?? null;
        focusManager?.popFocusScope(session.element);
        session.focusScopePushed = false;
    }

    private closeSession(session: OverlaySessionState): void {
        if (!session.visible || session.isDisposed) return;

        const root = this.getRoot();
        const focusManager = root?.focusManager ?? null;

        session.visible = false;
        this.setVisible(session.element, false);
        this.cleanupSessionListeners(session);
        this.releaseFocusScope(session);

        if (session.options.restoreFocus && session.savedFocus) {
            focusManager?.setFocus(session.savedFocus);
            session.savedFocus = null;
        }

        session.onClose?.();

        if (session.options.disposeOnClose) {
            this.disposeSession(session);
        }
    }

    private disposeSessionByElement(element: TUIElement): void {
        const session = this.sessions.get(element);
        if (!session) return;
        this.disposeSession(session);
    }

    private disposeSession(session: OverlaySessionState): void {
        /* v8 ignore start -- defensive: a disposed session is removed from the map and clearAll sets isDisposed directly, so disposeSession is never re-entered for the same session */
        if (session.isDisposed) return;
        /* v8 ignore stop */

        if (session.visible) {
            session.visible = false;
            this.setVisible(session.element, false);
            this.releaseFocusScope(session);
        }

        this.cleanupSessionListeners(session);

        const index = this.items.findIndex((item) => item.element === session.element);
        /* v8 ignore start -- defensive: createSession always adds the element to items, so a live session's element is always found here */
        if (index >= 0) {
            this.removeChild(this.items[index].element);
            this.items.splice(index, 1);
        }
        /* v8 ignore stop */

        session.isDisposed = true;
        session.savedFocus = null;
        this.sessions.delete(session.element);
        this.markDirty();
    }

    private attachSessionListeners(session: OverlaySessionState): void {
        const root = this.getRoot();
        if (!root) return;

        if (session.options.closeOnEscape && !session.rootEscapeHandler) {
            session.rootEscapeHandler = (event: TUIEventBase) => {
                /* v8 ignore start -- defensive: the handler is registered only for "keydown", so a non-keydown event never reaches it */
                if (event.type !== "keydown") return;
                /* v8 ignore stop */
                const keyEvent = event as TUIKeyboardEvent;
                if (keyEvent.key !== "Escape" || event.defaultPrevented) return;
                // Владелец может перехватить Escape (закрыть только подменю).
                if (session.shouldCloseOnEscape && !session.shouldCloseOnEscape()) return;
                this.closeSession(session);
            };
            root.addEventListener("keydown", session.rootEscapeHandler, { capture: true });
        }

        if (session.options.pointerPolicy === "close-on-outside" && !session.rootOutsideHandler) {
            session.rootOutsideHandler = (event: TUIEventBase) => {
                /* v8 ignore start -- defensive: the handler is registered only for "mousedown", so a non-mousedown event never reaches it */
                if (event.type !== "mousedown") return;
                /* v8 ignore stop */
                if (event.target && isInsideElement(event.target, session.element)) return;
                if (event.target && session.ownsTarget?.(event.target) === true) return;
                this.closeSession(session);
            };
            root.addEventListener("mousedown", session.rootOutsideHandler, { capture: true });
        }
    }

    private cleanupSessionListeners(session: OverlaySessionState): void {
        const root = this.getRoot();

        if (root && session.rootEscapeHandler) {
            root.removeEventListener("keydown", session.rootEscapeHandler, { capture: true });
        }
        if (root && session.rootOutsideHandler) {
            root.removeEventListener("mousedown", session.rootOutsideHandler, { capture: true });
        }

        session.rootEscapeHandler = null;
        session.rootOutsideHandler = null;
    }
}

function isInsideElement(element: TUIElement, ancestor: TUIElement): boolean {
    let current: TUIElement | null = element;
    while (current !== null) {
        if (current === ancestor) return true;
        current = current.getParent();
    }
    return false;
}
