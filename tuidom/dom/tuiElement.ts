import { DisplayLine } from "../common/displayLine.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../common/geometryPromitives.ts";
import type { CellPatch, ReadonlyCellData } from "../rendering/grid.ts";
import { TerminalScreen } from "../rendering/terminalScreen.ts";

import type { OverlayLayer } from "../ui/contextview/overlayLayer.ts";

import { BORDER_ROUNDED, type BorderStyle } from "./borderStyle.ts";
import type { FocusManager } from "./events/focusManager.ts";
import { EventPhase, TUIEventBase } from "./events/tuiEventBase.ts";
import type { TUIFocusEvent } from "./events/tuiFocusEvent.ts";
import { TUIKeyboardEvent } from "./events/tuiKeyboardEvent.ts";
import type { TUIMouseEvent } from "./events/tuiMouseEvent.ts";
import type { TUIPasteEvent } from "./events/tuiPasteEvent.ts";
import type { ResolvedTUIStyle, TUIStyle } from "./styles/tuiStyle.ts";
import { resolveStyle, ROOT_RESOLVED_STYLE } from "./styles/tuiStyle.ts";
import { querySelector, querySelectorAll } from "./tuiSelector.ts";

const MAX_COORD = 100_000;
const INFINITE_CLIP = new Rect(new Point(0, 0), new Size(MAX_COORD, MAX_COORD));

export class RenderContext {
    public readonly canvas: TerminalScreen;
    public readonly offset: Offset;
    public readonly clipRect: Rect;

    public constructor(canvas: TerminalScreen, offset: Offset = new Offset(0, 0), clipRect: Rect = INFINITE_CLIP) {
        this.canvas = canvas;
        this.offset = offset;
        this.clipRect = clipRect;
    }

    public withOffset(extra: Offset): RenderContext {
        return new RenderContext(
            this.canvas,
            new Offset(this.offset.dx + extra.dx, this.offset.dy + extra.dy),
            this.clipRect,
        );
    }

    public withClip(rect: Rect): RenderContext {
        return new RenderContext(this.canvas, this.offset, this.clipRect.intersect(rect));
    }

    public setCell(x: number, y: number, cell: CellPatch): void {
        const screenX = x + this.offset.dx;
        const screenY = y + this.offset.dy;
        if (!this.clipRect.containsPoint(new Point(screenX, screenY))) return;
        this.canvas.setCell(new Point(screenX, screenY), cell);
    }

    /**
     * Читает уже отрисованную ячейку в локальных координатах (тот же оффсет и
     * клип, что у {@link setCell}). Возвращает null вне клипа или вне экрана.
     * Нужен пост-обработке вроде оверлея выделения в списках: прочитать ячейку,
     * решить по её текущим цветам и патчнуть через {@link setCell}.
     */
    public getCell(x: number, y: number): ReadonlyCellData | null {
        const screenX = x + this.offset.dx;
        const screenY = y + this.offset.dy;
        if (!this.clipRect.containsPoint(new Point(screenX, screenY))) return null;
        if (screenX < 0 || screenY < 0 || screenX >= this.canvas.width || screenY >= this.canvas.height) return null;
        return this.canvas.getCell(new Point(screenX, screenY));
    }

    public setCursorPosition(x: number, y: number): void {
        const screenX = x + this.offset.dx;
        const screenY = y + this.offset.dy;
        if (!this.clipRect.containsPoint(new Point(screenX, screenY))) return;
        this.canvas.setCursorPosition(new Point(screenX, screenY));
    }

    /**
     * Render a text string at (x, y), handling wide chars, tabs, combining marks and emoji.
     * Each column within [startCol, startCol + maxWidth) is rendered.
     *
     * @param x       Left screen column (local coordinates)
     * @param y       Screen row (local coordinates)
     * @param text    Raw text to render
     * @param style   Optional cell style (fg, bg, style flags) applied to every cell
     * @param options tabSize (default 4) and maxWidth (default: no limit)
     * @returns Number of display columns written
     */
    public drawText(
        x: number,
        y: number,
        text: string,
        style?: { fg?: number; bg?: number; style?: number },
        options?: {
            tabSize?: number;
            maxWidth?: number;
            getStyle?: (offset: number) => { fg?: number; bg?: number; style?: number } | undefined;
        },
    ): number {
        const dl = new DisplayLine(text, options?.tabSize);
        const maxWidth = options?.maxWidth ?? dl.displayWidth;
        let col = 0;
        while (col < maxWidth) {
            const char = dl.charAtColumn(col);
            /* v8 ignore start -- unreachable: the loop always advances col past a wide char's continuation cell, so charAtColumn never returns "" here */
            if (char === "") {
                col++;
                continue;
            }
            /* v8 ignore stop */
            const slot = dl.graphemeAtColumn(col);
            const w = slot ? slot.displayWidth : 1;
            const slotStyle = slot && options?.getStyle ? options.getStyle(slot.offset) : undefined;
            const resolvedStyle = slotStyle !== undefined ? { ...style, ...slotStyle } : style;
            if (w === 2 && col + 1 >= maxWidth) {
                this.setCell(x + col, y, { char: " ", width: 1, ...resolvedStyle });
                col++;
            } else {
                this.setCell(x + col, y, { char, width: w, ...resolvedStyle });
                col += w;
            }
        }
        return col;
    }

    /**
     * Отрисовывает прямоугольную рамку box-drawing глифами — единый хелпер для
     * всех бордер-виджетов (см. {@link BorderStyle}). Рисует углы, верхнюю/нижнюю
     * горизонтали и боковые вертикали; строки из `separators` (offset от верха
     * рамки, 1-based относительно `y`) рисуются как T-коннекторы `├───┤`.
     *
     * Координаты локальные (как у {@link drawText}). Клиппинг/оффсет применяются
     * через {@link setCell}.
     *
     * @param x       Левый столбец рамки
     * @param y       Верхняя строка рамки
     * @param width   Ширина рамки в столбцах (>= 2)
     * @param height  Высота рамки в строках (>= 2)
     * @param options fg/bg, пресет `style` (по умолчанию {@link BORDER_ROUNDED} —
     *                канонический стиль оверлеев Vexx), `fill` (залить фон внутри
     *                рамки), `separators` (ряды-разделители)
     */
    public drawBox(
        x: number,
        y: number,
        width: number,
        height: number,
        options: {
            fg?: number;
            bg?: number;
            style?: BorderStyle;
            fill?: boolean;
            separators?: readonly number[];
        } = {},
    ): void {
        const style = options.style ?? BORDER_ROUNDED;
        const fg = options.fg;
        const bg = options.bg;
        const right = x + width - 1;
        const bottom = y + height - 1;

        if (options.fill === true) {
            for (let yy = y; yy <= bottom; yy++) {
                for (let xx = x; xx <= right; xx++) {
                    this.setCell(xx, yy, { char: " ", fg, bg });
                }
            }
        }

        const separators = new Set(options.separators);

        // Top border.
        this.setCell(x, y, { char: style.topLeft, fg, bg });
        this.setCell(right, y, { char: style.topRight, fg, bg });
        for (let xx = x + 1; xx < right; xx++) this.setCell(xx, y, { char: style.horizontal, fg, bg });

        // Side borders (+ separator T-connectors).
        for (let yy = y + 1; yy < bottom; yy++) {
            if (separators.has(yy - y)) {
                this.setCell(x, yy, { char: style.leftJoint, fg, bg });
                this.setCell(right, yy, { char: style.rightJoint, fg, bg });
                for (let xx = x + 1; xx < right; xx++) this.setCell(xx, yy, { char: style.horizontal, fg, bg });
            } else {
                this.setCell(x, yy, { char: style.vertical, fg, bg });
                this.setCell(right, yy, { char: style.vertical, fg, bg });
            }
        }

        // Bottom border.
        this.setCell(x, bottom, { char: style.bottomLeft, fg, bg });
        this.setCell(right, bottom, { char: style.bottomRight, fg, bg });
        for (let xx = x + 1; xx < right; xx++) this.setCell(xx, bottom, { char: style.horizontal, fg, bg });
    }
}

export interface AddEventListenerOptions {
    capture?: boolean;
}

export interface TUIElementEventMap {
    keydown: TUIKeyboardEvent;
    keyup: TUIKeyboardEvent;
    keypress: TUIKeyboardEvent;
    focus: TUIFocusEvent;
    blur: TUIFocusEvent;
    mousedown: TUIMouseEvent;
    mouseup: TUIMouseEvent;
    mousemove: TUIMouseEvent;
    click: TUIMouseEvent;
    dblclick: TUIMouseEvent;
    mouseenter: TUIMouseEvent;
    mouseleave: TUIMouseEvent;
    wheel: TUIMouseEvent;
    paste: TUIPasteEvent;
}

interface ListenerEntry {
    handler: (event: TUIEventBase) => void;
    capture: boolean;
}

export class TUIElement<S extends TUIStyle = TUIStyle> {
    private allocatedSize: Size = new Size(80, 24);

    public dirty = false;
    public layoutStyle: unknown = undefined;
    public layoutState: unknown = undefined;

    // Identity
    public id: string | undefined = undefined;
    public role: string | undefined = undefined;

    // Focus support
    public tabIndex = -1;

    // Pointer capture (opt-in): while a button is held on this element, the dispatcher
    // routes subsequent move/release events here even if the cursor leaves its bounds.
    public capturesPointer = false;

    // Coordinate system
    public localPosition: Offset = new Offset(0, 0);
    public isLayoutDirty = true;
    protected _parent: TUIElement | null = null;
    protected root: TUIElement | null = null;

    // Callback invoked when markDirty reaches the root — used by TuiApplication to schedule a render
    private requestRenderCallback: (() => void) | null = null;

    // Focus manager — set only on root element
    public focusManager: FocusManager | null = null;

    // ─── Style system ───
    private styleValue: Readonly<S> = {} as S;
    private resolvedStyleValue: ResolvedTUIStyle = ROOT_RESOLVED_STYLE;
    private isStyleDirty = true;
    private subtreeStyleDirty = false;

    public get style(): Readonly<S> {
        return this.styleValue;
    }

    public set style(value: S) {
        this.styleValue = value;
        this.markStyleDirty();
    }

    // Event listener storage — supports any event type + capture flag
    private _listeners = new Map<string, ListenerEntry[]>();

    /**
     * Allocated visible area on screen, set by parent container via performLayout().
     * Lazy fallback: if layout is dirty, triggers performLayout with loose constraints.
     */
    public get layoutSize(): Size {
        if (this.isLayoutDirty) {
            const constraints = BoxConstraints.loose(this.allocatedSize);
            this.performLayout(constraints);
        }
        return this.allocatedSize;
    }

    public get isFocused(): boolean {
        const fm = this.root?.focusManager ?? null;
        return fm !== null && fm.activeElement === this;
    }

    public getParent(): TUIElement | null {
        return this._parent;
    }

    /**
     * Абсолютная позиция элемента на экране — **производная** от цепочки
     * родителей: `parent.globalPosition + localPosition`. Раньше это было поле,
     * которое каждый контейнер обязан был выставлять руками параллельно с
     * `localPosition` (LAYOUT.md честно писал «в корректном состоянии они
     * равны») — забытая запись давала элемент, который рисуется, но не
     * кликается. Теперь рассинхрон невозможен по построению.
     *
     * У отсоединённого элемента (parent=null) равна `localPosition` — так
     * standalone-рендер в тестах может позиционировать элемент напрямую.
     */
    public get globalPosition(): Point {
        const parent = this._parent;
        if (parent === null) {
            return new Point(this.localPosition.dx, this.localPosition.dy);
        }
        const parentGlobal = parent.globalPosition;
        return new Point(parentGlobal.x + this.localPosition.dx, parentGlobal.y + this.localPosition.dy);
    }

    public getChildren(): readonly TUIElement[] {
        return [];
    }

    /**
     * Observable state for the inspector, self-described by the widget. The base
     * returns `undefined` (no state to report); interactive widgets override to
     * expose what a test would otherwise have to infer from rendered cells — an
     * editor's cursor/selection/readonly, a panel's active tab, a quick-pick's
     * items. Must be a plain JSON-serialisable snapshot, not live internals:
     * it crosses the inspector wire and is a public contract (test it).
     */
    public inspectState(): Record<string, unknown> | undefined {
        return undefined;
    }

    /**
     * Builds the path from root to this element (inclusive on both ends).
     */
    public getAncestorPath(): TUIElement[] {
        const path: TUIElement[] = [];
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let current: TUIElement | null = this;
        while (current !== null) {
            path.push(current);
            current = current._parent;
        }
        path.reverse();
        return path;
    }

    /**
     * Returns focusable descendants (tabIndex >= 0) in depth-first order.
     */
    /**
     * Порядок Tab-обхода поддерева. Рекурсия идёт через этот же метод у детей, а
     * не через плоский обход `getChildren()`: контейнеры, у которых часть детей
     * не участвует в навигации (скрытые сессии `OverlayLayer`), переопределяют
     * его и обязаны быть услышанными.
     */
    public getDepthFirstFocusableOrder(): TUIElement[] {
        const result: TUIElement[] = [];
        if (this.tabIndex >= 0) result.push(this);
        for (const child of this.getChildren()) {
            result.push(...child.getDepthFirstFocusableOrder());
        }
        return result;
    }

    // ─── Event API (capture/bubble propagation) ───

    public addEventListener<K extends keyof TUIElementEventMap>(
        type: K,
        handler: (event: TUIElementEventMap[K]) => void,
        options?: AddEventListenerOptions,
    ): void;
    public addEventListener(
        type: string,
        handler: (event: TUIEventBase) => void,
        options?: AddEventListenerOptions,
    ): void;
    public addEventListener(
        type: string,
        handler: (event: TUIEventBase) => void,
        options?: AddEventListenerOptions,
    ): void {
        const capture = options?.capture ?? false;
        let entries = this._listeners.get(type);
        if (!entries) {
            entries = [];
            this._listeners.set(type, entries);
        }
        entries.push({ handler, capture });
    }

    public removeEventListener<K extends keyof TUIElementEventMap>(
        type: K,
        handler: (event: TUIElementEventMap[K]) => void,
        options?: AddEventListenerOptions,
    ): void;
    public removeEventListener(
        type: string,
        handler: (event: TUIEventBase) => void,
        options?: AddEventListenerOptions,
    ): void;
    public removeEventListener(
        type: string,
        handler: (event: TUIEventBase) => void,
        options?: AddEventListenerOptions,
    ): void {
        const capture = options?.capture ?? false;
        const entries = this._listeners.get(type);
        if (!entries) return;
        const index = entries.findIndex((e) => e.handler === handler && e.capture === capture);
        if (index !== -1) {
            entries.splice(index, 1);
        }
    }

    /**
     * Dispatches event with capture → target → bubble phases (DOM-like).
     * Returns true if preventDefault() was NOT called.
     */
    public dispatchEvent(event: TUIEventBase): boolean {
        event.target = this;

        // Build path from root → ... → parent (excluding target)
        const path: TUIElement[] = [];
        let current: TUIElement | null = this._parent;
        while (current !== null) {
            path.push(current);
            current = current._parent;
        }
        path.reverse(); // root first

        // Capture phase
        event.eventPhase = EventPhase.CAPTURING;
        for (const el of path) {
            event.currentTarget = el;
            this._invokeListeners(el, event, true);
            if (event.propagationStopped) break;
        }

        // Target phase
        if (!event.propagationStopped) {
            event.eventPhase = EventPhase.AT_TARGET;
            event.currentTarget = this;
            this._invokeListeners(this, event, null); // both capture and bubble listeners
        }

        // Bubble phase
        if (!event.propagationStopped && event.bubbles) {
            event.eventPhase = EventPhase.BUBBLING;
            for (let i = path.length - 1; i >= 0; i--) {
                event.currentTarget = path[i];
                this._invokeListeners(path[i], event, false);
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- side effect from handler
                if (event.propagationStopped) break;
            }
        }

        event.eventPhase = EventPhase.NONE;
        event.currentTarget = null;

        // Default action — analogous to Web DOM default actions.
        // Runs on the target element after all propagation phases.
        // Cancelled by preventDefault() from any listener.
        if (!event.defaultPrevented) {
            this.performDefaultAction(event);
        }

        return !event.defaultPrevented;
    }

    /**
     * Override in subclasses to define built-in element behavior (like opening a menu on click).
     * Called after all capture/target/bubble listeners. Skipped if preventDefault() was called.
     * Analogous to Web DOM default actions (e.g. <a> navigation, <input> text entry).
     */
    protected performDefaultAction(event: TUIEventBase): void {
        if (event.type === "mousedown" && this.tabIndex >= 0) {
            this.focus();
        }
    }

    /**
     * Invoke listeners on an element for the given event.
     * captureFilter: true = only capture, false = only bubble, null = both (target phase)
     */
    private _invokeListeners(el: TUIElement, event: TUIEventBase, captureFilter: boolean | null): void {
        const entries = el._listeners.get(event.type);
        if (!entries) return;
        // Snapshot to avoid mutation during iteration
        const snapshot = entries.slice();
        for (const entry of snapshot) {
            if (captureFilter === null || entry.capture === captureFilter) {
                entry.handler(event);
                if (event.immediatePropagationStopped) break;
            }
        }
    }

    // ─── Style system ───

    public get resolvedStyle(): ResolvedTUIStyle {
        return this.resolvedStyleValue;
    }

    /**
     * Forces a style re-resolution of this element and its whole subtree (and
     * schedules a render). Public so a container can refresh a subtree it just
     * re-attached — e.g. a panel that was excluded from `getChildren()` while
     * hidden and thus missed style propagation.
     */
    public markStyleDirty(): void {
        this.isStyleDirty = true;
        for (const child of this.getChildren()) {
            child.markStyleDirty();
        }
        this.markSubtreeStyleDirtyUp();
        this.markDirty();
    }

    private markSubtreeStyleDirtyUp(): void {
        let current = this._parent;
        while (current && !current.subtreeStyleDirty) {
            current.subtreeStyleDirty = true;
            current = current._parent;
        }
    }

    public performStyleResolution(inherited: ResolvedTUIStyle): void {
        if (!this.isStyleDirty && !this.subtreeStyleDirty) return;

        if (this.isStyleDirty) {
            this.resolvedStyleValue = resolveStyle(this.style, inherited);
        }
        this.isStyleDirty = false;
        this.subtreeStyleDirty = false;

        for (const child of this.getChildren()) {
            child.performStyleResolution(this.resolvedStyleValue);
        }
    }

    // ─── Focus convenience ───

    public focus(): void {
        const fm = this.root?.focusManager ?? null;
        if (fm) {
            fm.setFocus(this);
        }
    }

    public blur(): void {
        const fm = this.root?.focusManager ?? null;
        if (fm?.activeElement === this) {
            fm.setFocus(null);
        }
    }

    /**
     * Marks this element and ancestors as dirty.
     * Call this when layout-affecting properties change.
     *
     * When propagation reaches the root (no parent), fires the
     * requestRenderCallback so TuiApplication can schedule a deferred render.
     * Batching is handled by TuiApplication.scheduleRender().
     */
    public markDirty(): void {
        this.isLayoutDirty = true;
        if (this._parent) {
            this._parent.markDirty();
        } else if (this.requestRenderCallback) {
            this.requestRenderCallback();
        }
    }

    /**
     * Sets parent reference for dirty propagation and root reference propagation.
     * Called by parent elements when adding children.
     */
    public setParent(parent: TUIElement | null): void {
        this._parent = parent;
        const newRoot = parent ? parent.root : null;
        this.propagateRoot(newRoot);
        if (parent && (this.isStyleDirty || this.subtreeStyleDirty)) {
            this.markSubtreeStyleDirtyUp();
        }
    }

    private propagateRoot(newRoot: TUIElement | null): void {
        if (newRoot === null && this.root?.focusManager?.activeElement === this) {
            this.root.focusManager.setFocus(null);
        }
        this.root = newRoot;
        for (const child of this.getChildren()) {
            child.propagateRoot(newRoot);
        }
    }

    /**
     * Returns the root element of the hierarchy.
     */
    public getRoot(): TUIElement | null {
        return this.root;
    }

    /**
     * Ближайший overlay-слой вверх по дереву (попапы, контекстные меню,
     * докнутые виджеты). Элементы-хосты слоёв (BodyElement, EditorGroupElement)
     * переопределяют и возвращают свой слой.
     */
    public getOverlayLayer(): OverlayLayer | null {
        return this.getParent()?.getOverlayLayer() ?? null;
    }

    /**
     * Sets this element as the root (used for testing and by BodyElement).
     */
    public setAsRoot(): void {
        this.root = this;
    }

    /**
     * Sets a callback to be invoked when markDirty() reaches the root element.
     * Used by TuiApplication to schedule async re-renders.
     */
    public setRequestRenderCallback(callback: (() => void) | null): void {
        this.requestRenderCallback = callback;
    }

    // ─── Intrinsic Size API ───

    public getMinIntrinsicWidth(_height: number): number {
        return 0;
    }

    public getMaxIntrinsicWidth(_height: number): number {
        return 0;
    }

    public getMinIntrinsicHeight(_width: number): number {
        return 0;
    }

    public getMaxIntrinsicHeight(_width: number): number {
        return 0;
    }

    /**
     * Хелпер контейнера: позиционирует ребёнка (localPosition) и прогоняет его
     * layout — одна строка вместо ритуала из двух-трёх записей. globalPosition
     * не трогает: он производный.
     */
    protected layoutChild(child: TUIElement, x: number, y: number, constraints: BoxConstraints): Size {
        child.localPosition = new Offset(x, y);
        return child.performLayout(constraints);
    }

    /**
     * Performs layout: applies constraints to set the allocated visible area.
     */
    public performLayout(constraints: BoxConstraints): Size {
        const resultSize = constraints.constrain(this.allocatedSize);
        this.allocatedSize = resultSize;
        this.isLayoutDirty = false;
        return resultSize;
    }

    public render(_context: RenderContext): void {
        // Base implementation does nothing.
        // Subclasses override to draw themselves.
    }

    // ─── Hit-testing ───

    // eslint-disable-next-line @typescript-eslint/prefer-return-this-type
    public elementFromPoint(point: Point): TUIElement | null {
        const bounds = new Rect(this.globalPosition, this.layoutSize);
        if (!bounds.containsPoint(point)) return null;

        const children = this.getChildren();
        for (let i = children.length - 1; i >= 0; i--) {
            const hit = children[i].elementFromPoint(point);
            if (hit) return hit;
        }

        return this;
    }

    // ─── Query API (querySelector / querySelectorAll) ───

    public querySelector(selector: string): TUIElement | null {
        return querySelector(this, selector);
    }

    public querySelectorAll(selector: string): TUIElement[] {
        return querySelectorAll(this, selector);
    }
}
