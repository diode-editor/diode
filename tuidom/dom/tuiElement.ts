import { DEFAULT_COLOR } from "../common/colorUtils.ts";
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
import type { AnyStyleToken } from "./styles/styleTokens.ts";
import { ROOT_VAR_SCOPE } from "./styles/styleTokens.ts";
import type {
    ResolvedTUIStyle,
    StyleColor,
    StyleResolutionContext,
    StyleState,
    StyleStateSelector,
    TUIStyle,
} from "./styles/tuiStyle.ts";
import type { StyleVarScope } from "./styles/tuiStyle.ts";
import {
    extendVarScope,
    mergeStyleVariants,
    resolveStyleColor,
    ROOT_RESOLVED_STYLE,
    ROOT_STYLE_CONTEXT,
    styleEquals,
} from "./styles/tuiStyle.ts";
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

    // Участие в Tab-обходе и фокусе по клику. Порядок обхода — это порядок
    // детей в дереве (как z-порядок и хит-тест); числового приоритета в духе
    // DOM tabindex нет намеренно — он был бы вторым источником порядка.
    public focusable = false;

    // Pointer capture (opt-in): while a button is held on this element, the dispatcher
    // routes subsequent move/release events here even if the cursor leaves its bounds.
    public capturesPointer = false;

    // Coordinate system
    public localPosition: Offset = new Offset(0, 0);
    public isLayoutDirty = true;
    protected _parent: TUIElement | null = null;
    // Якорь дерева: выставляется setAsRoot() (BodyElement, тестовые корни).
    // Сам root НЕ кэшируется — getRoot() выводит его из цепочки родителей.
    private isRootAnchor = false;

    // Callback invoked when markDirty reaches the root — used by TuiApplication to schedule a render
    private requestRenderCallback: (() => void) | null = null;

    // Focus manager — set only on root element
    public focusManager: FocusManager | null = null;

    // ─── Style system ───
    private styleValue: Readonly<S> = {} as S;
    private resolvedStyleValue: ResolvedTUIStyle = ROOT_RESOLVED_STYLE;
    private isStyleDirty = true;
    private subtreeStyleDirty = false;
    // Сырые цвета ПОСЛЕ when-merge (до резолва сентинелов) — отвечают на
    // вопрос «задан ли цвет собственным стилем» (заливка фона, инспектор).
    private appliedFgValue: StyleColor | undefined;
    private appliedBgValue: StyleColor | undefined;
    // Активные состояния (hover/focus ведёт ядро, прочие — виджеты). Lazy:
    // у подавляющего большинства элементов состояний нет.
    private styleStatesSet: Set<string> | null = null;
    // Собственная таблица токенов (обычно только у корня — хост кладёт тему).
    private styleVarsValue: Readonly<Record<string, number>> | null = null;
    // Ближайший резолвленный var-scope — источник styleVar(). До первого
    // резолва — дефолты tuidom.
    private varScopeRef: StyleVarScope = ROOT_VAR_SCOPE;
    // Контекст, переданный детям на последнем резолве. Валиден, пока элемент
    // чист: любая смена входа (стиль/состояние предка) дирявит всё поддерево.
    private childStyleContext: StyleResolutionContext = ROOT_STYLE_CONTEXT;

    public get style(): Readonly<S> {
        return this.styleValue;
    }

    public set style(value: S) {
        if (styleEquals(this.styleValue, value)) return;
        this.styleValue = value;
        this.markStyleDirty();
    }

    // Event listener storage — supports any event type + capture flag
    private _listeners = new Map<string, ListenerEntry[]>();

    /**
     * Allocated visible area on screen, set by parent container via layout().
     * Lazy fallback: if layout is dirty, triggers layout with loose constraints.
     */
    public get layoutSize(): Size {
        if (this.isLayoutDirty) {
            const constraints = BoxConstraints.loose(this.allocatedSize);
            this.layout(constraints);
        }
        return this.allocatedSize;
    }

    public get isFocused(): boolean {
        const fm = this.getRoot()?.focusManager ?? null;
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

    // ─── Владение детьми ───
    //
    // Список детей принадлежит базовому классу; топология меняется ТОЛЬКО через
    // appendChild/insertChild/removeChild/replaceChild/setChildren — они же
    // атомарно поддерживают обратную ссылку parent. getChildren() не
    // переопределяется: «ребёнок в списке, но parent не выставлен» (и наоборот)
    // непредставимы. Порядок детей — это z-порядок хит-теста (последний сверху)
    // и порядок Tab-обхода; контейнер задаёт его порядком вставки/setChildren.

    private childrenList: TUIElement[] = [];

    public getChildren(): readonly TUIElement[] {
        return this.childrenList;
    }

    /**
     * Видимость (аналог display:none): скрытый элемент ОСТАЁТСЯ в дереве —
     * root и каскад стилей до него доходят, — но выпадает из hit-теста и
     * Tab-обхода (базовые обходы), а контейнер не раскладывает и не рисует его.
     * Это разводит «структуру» и «что сейчас видно», которые раньше смешивал
     * getChildren(): контейнеры исключали скрытых детей из структуры и потом
     * руками чинили пропагацию при показе (источник семейства багов #204).
     */
    public get hidden(): boolean {
        return this.hiddenValue;
    }

    public set hidden(value: boolean) {
        if (this.hiddenValue === value) return;
        this.hiddenValue = value;
        // Фокус НЕ трогаем: куда уходит фокус при скрытии — политика уровня
        // workbench (PanelFocusContribution возвращает его в редактор, оверлей
        // восстанавливает savedFocus). База лишь гарантирует, что Tab-обход и
        // hit-test в скрытое не заходят.
        this.markDirty();
    }

    private hiddenValue = false;

    /** Прикрепляет ребёнка в конец списка (снимая с прежнего родителя). */
    protected appendChild(child: TUIElement): void {
        this.insertChild(this.childrenList.length, child);
    }

    /** Прикрепляет ребёнка на позицию index (снимая с прежнего родителя). */
    protected insertChild(index: number, child: TUIElement): void {
        if (child === this) {
            throw new Error("TUIElement: элемент не может быть собственным ребёнком");
        }
        child._parent?.removeChild(child);
        this.childrenList.splice(index, 0, child);
        child.setParent(this);
        this.markDirty();
    }

    /** Отцепляет ребёнка (no-op, если он не наш). */
    protected removeChild(child: TUIElement): void {
        const index = this.childrenList.indexOf(child);
        if (index === -1) return;
        this.childrenList.splice(index, 1);
        child.setParent(null);
        this.markDirty();
    }

    /**
     * Заменяет ребёнка, сохраняя позицию в списке — а значит z-порядок и место
     * в Tab-обходе (важно слотовым контейнерам: content меняется, а overlay
     * обязан остаться поверх).
     */
    protected replaceChild(oldChild: TUIElement, newChild: TUIElement): void {
        if (oldChild === newChild) return;
        const index = this.childrenList.indexOf(oldChild);
        if (index === -1) {
            this.appendChild(newChild);
            return;
        }
        newChild._parent?.removeChild(newChild);
        oldChild.setParent(null);
        this.childrenList[index] = newChild;
        newChild.setParent(this);
        this.markDirty();
    }

    /**
     * Декларативно приводит список детей к заданному (слотовые контейнеры
     * пересобирают канонический порядок одним вызовом). Лишние отцепляются,
     * новые прикрепляются, порядок — как в next.
     */
    protected setChildren(next: readonly TUIElement[]): void {
        const nextSet = new Set(next);
        if (nextSet.size !== next.length) {
            throw new Error("TUIElement.setChildren: один элемент дважды в списке");
        }
        for (const child of this.childrenList) {
            if (!nextSet.has(child)) {
                child.setParent(null);
            }
        }
        for (const child of next) {
            if (child._parent !== this) {
                child._parent?.removeChild(child);
                child.setParent(this);
            }
        }
        this.childrenList = [...next];
        this.markDirty();
    }

    /** Гасит фокус, если activeElement — этот элемент или его потомок. */
    private releaseFocusIfInside(): void {
        const fm = this.getRoot()?.focusManager ?? null;
        let node = fm?.activeElement ?? null;
        while (node !== null && node !== this) {
            node = node.getParent();
        }
        if (node === this) {
            fm!.setFocus(null);
        }
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
     * Порядок Tab-обхода поддерева: фокусируемые (focusable) в глубину.
     * Скрытые (hidden) поддеревья пропускаются целиком — Tab не должен уводить
     * фокус в невидимый инпут (закрытый find-виджет, неактивная вкладка).
     */
    public getDepthFirstFocusableOrder(): TUIElement[] {
        if (this.hidden) return [];
        const result: TUIElement[] = [];
        if (this.focusable) result.push(this);
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
        if (event.type === "mousedown" && this.focusable) {
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

    public performStyleResolution(context: StyleResolutionContext): void {
        if (!this.isStyleDirty && !this.subtreeStyleDirty) return;

        if (this.isStyleDirty) {
            const applied = mergeStyleVariants(this.style, (selector) =>
                this.isStyleSelectorActive(selector, context.ancestorStates),
            );
            this.appliedFgValue = applied.fg;
            this.appliedBgValue = applied.bg;
            const vars =
                this.styleVarsValue !== null ? extendVarScope(context.vars, this.styleVarsValue) : context.vars;
            this.varScopeRef = vars;
            const describe = (): string => this.describeForStyleError();
            const fg =
                applied.fg !== undefined
                    ? resolveStyleColor(applied.fg, context.fg, context.bg, vars, describe)
                    : context.fg;
            const bg =
                applied.bg !== undefined
                    ? resolveStyleColor(applied.bg, context.fg, context.bg, vars, describe)
                    : context.bg;
            this.resolvedStyleValue = { fg, bg };
            this.childStyleContext = this.buildChildStyleContext(context);
        }
        this.isStyleDirty = false;
        this.subtreeStyleDirty = false;

        for (const child of this.getChildren()) {
            child.performStyleResolution(this.childStyleContext);
        }
    }

    private isStyleSelectorActive(selector: StyleStateSelector, ancestorStates: ReadonlySet<string>): boolean {
        if (selector.startsWith("in:")) {
            const state = selector.slice(3);
            return this.styleStatesSet?.has(state) === true || ancestorStates.has(state);
        }
        return this.styleStatesSet?.has(selector) === true;
    }

    private buildChildStyleContext(context: StyleResolutionContext): StyleResolutionContext {
        const { fg, bg } = this.resolvedStyleValue;
        let ancestorStates = context.ancestorStates;
        if (this.styleStatesSet !== null && this.styleStatesSet.size > 0) {
            const union = new Set(context.ancestorStates);
            for (const state of this.styleStatesSet) {
                union.add(state);
            }
            ancestorStates = union;
        }
        return { fg, bg, vars: this.varScopeRef, ancestorStates };
    }

    private describeForStyleError(): string {
        const id = this.id !== undefined ? `#${this.id}` : "";
        return `${this.constructor.name}${id}`;
    }

    // ─── Переменные стиля (токены) ───

    /**
     * Кладёт таблицу токен→число, каскадирующую в поддерево ПОВЕРХ таблиц
     * предков и дефолтов tuidom (STYLE_TOKEN_DEFAULTS). Обычное место — корень:
     * хост транслирует сюда палитру темы одним вызовом (hot-swap = повторный
     * вызов). Таблица заменяется целиком, null — снимает. Значения — только
     * конкретные числа (packed RGB | DEFAULT_COLOR); сентинелы INHERITED_*
     * нелегальны.
     */
    public setStyleVars(vars: Readonly<Record<string, number>> | null): void {
        if (vars === this.styleVarsValue) return;
        if (vars !== null) {
            for (const key of Object.keys(vars)) {
                if (vars[key] < DEFAULT_COLOR) {
                    throw new Error(
                        `${this.describeForStyleError()}.setStyleVars: токен "${key}" содержит сентинел/некорректное значение ${vars[key]} — таблицы принимают только конкретные цвета`,
                    );
                }
            }
        }
        this.styleVarsValue = vars;
        this.markStyleDirty();
    }

    /**
     * Читает токен из ближайшего резолвленного var-scope — для painter-виджетов,
     * рисующих несколько цветов в custom render. Валидно после резолва стилей
     * (render всегда после него в кадре); до первого резолва видит дефолты
     * tuidom. Незнакомый токен — throw.
     */
    public styleVar(name: AnyStyleToken): number {
        const value = this.varScopeRef[name];
        if (typeof value !== "number") {
            throw new Error(`${this.describeForStyleError()}.styleVar: неизвестный цветовой токен "${name}"`);
        }
        return value;
    }

    // ─── Состояния стиля ───

    /**
     * Ставит/снимает состояние стиля. hover и focus ведёт ядро (диспатчер
     * мыши и менеджер фокуса); произвольные строковые состояния ("selected",
     * "checked", …) виджеты ставят сами. Смена состояния перерезолвит стиль
     * элемента и поддерева: дети наследуют РЕЗУЛЬТАТ родителя с учётом его
     * состояний, а `in:`-селекторы потомков видят состояния предков.
     */
    public setStyleState(state: StyleState, active: boolean): void {
        const current = this.styleStatesSet?.has(state) === true;
        if (current === active) return;
        if (active) {
            (this.styleStatesSet ??= new Set()).add(state);
        } else {
            this.styleStatesSet?.delete(state);
        }
        this.markStyleDirty();
    }

    public hasStyleState(state: StyleState): boolean {
        return this.styleStatesSet?.has(state) === true;
    }

    /** Активные состояния (порядок вставки) — инспектор/тесты. */
    public get activeStyleStates(): readonly string[] {
        return this.styleStatesSet !== null ? [...this.styleStatesSet] : [];
    }

    // ─── Focus convenience ───

    public focus(): void {
        const fm = this.getRoot()?.focusManager ?? null;
        if (fm) {
            fm.setFocus(this);
        }
    }

    public blur(): void {
        const fm = this.getRoot()?.focusManager ?? null;
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
     * Внутренний сеттер обратной ссылки — вызывается ТОЛЬКО из
     * appendChild/insertChild/removeChild/replaceChild/setChildren, поэтому
     * список детей и parent меняются строго вместе. Отцепление (parent=null)
     * гасит фокус, если он был внутри отцепляемого поддерева — иначе
     * клавиатура продолжала бы уходить в элемент, которого больше нет на
     * экране. После смены зовёт {@link onDidChangeParent} (хук для виджетов,
     * вешающих слушатели на родителя, — MenuBarElement).
     */
    private setParent(parent: TUIElement | null): void {
        const oldRoot = this.getRoot(); // снимок ДО мутации — по ещё живой цепочке
        if (parent === null && this._parent !== null) {
            this.releaseFocusIfInside();
        }
        const oldParent = this._parent;
        this._parent = parent;
        if (parent) {
            // Безусловно: даже чистое поддерево обязано пере-резолвиться в
            // контексте нового родителя (другой каскад/состояния предков).
            this.markStyleDirty();
        }
        this.onDidChangeParent(oldParent, parent);

        const newRoot = this.getRoot();
        if (oldRoot !== newRoot) {
            if (oldRoot !== null) this.fireDidDisconnect();
            if (newRoot !== null) this.fireDidConnect(newRoot);
        }
    }

    /**
     * Хук смены родителя: вызывается после каждого перецепления. Базовая
     * реализация пуста; переопределяется вместо запрещённого override
     * setParent. Для доступа к КОРНЮ используйте {@link onDidConnect} — на
     * момент этого хука поддерево может быть ещё не укоренено.
     */
    protected onDidChangeParent(_oldParent: TUIElement | null, _newParent: TUIElement | null): void {
        // Базовая реализация ничего не делает.
    }

    // ─── Подключение к дереву (аналог DOM connectedCallback) ───
    //
    // «Прикреплён к родителю» ≠ «подключён к укоренённому дереву»: поддерево
    // может собираться отвязанно и укорениться позже (или наоборот). Хуки ниже
    // сообщают каждому узлу перемещаемого поддерева о смене укоренённости —
    // это пропагация СОБЫТИЯ, не состояния (getRoot() остаётся производным,
    // протухать нечему; ср. кэш root, удалённый в #214).

    /**
     * Поддерево подключилось к укоренённому дереву: внутри хука
     * `getRoot() === root`. Перенос между родителями (даже внутри одного
     * дерева) — это всегда пара disconnect → connect: будьте идемпотентны.
     * Скрытые (hidden) узлы получают хук наравне с видимыми — подключение
     * не зависит от видимости. НЕ полагайтесь на `root.focusManager` — он
     * появляется позже (TuiApplication.run). Хук не должен бросать; мутации
     * разрешены только в собственном поддереве. Если хук удаляет узел из ещё
     * не обойдённой части дерева, тот получит disconnect без предшествовавшего
     * connect-уведомления (подключение — факт топологии, уведомления
     * догоняют).
     */
    protected onDidConnect(_root: TUIElement): void {
        // Базовая реализация ничего не делает.
    }

    /**
     * Поддерево отключилось от укоренённого дерева: внутри хука
     * `getRoot() === null`. Прежний root хук хранит сам, если нужен для
     * отписки (DOM-прецедент: disconnectedCallback тоже без аргументов).
     */
    protected onDidDisconnect(): void {
        // Базовая реализация ничего не делает.
    }

    /** Подключён ли элемент к укоренённому дереву. */
    public get isConnected(): boolean {
        return this.getRoot() !== null;
    }

    /**
     * Pre-order обход поддерева (родитель раньше детей — DOM tree order).
     * Снимок детей берётся ДО вызова хука узла, перед рекурсией проверяется
     * актуальность связи: ребёнок, добавленный хуком, получит свой connect
     * через собственный setParent; удалённый — уже получил disconnect и
     * пропускается.
     */
    private fireDidConnect(root: TUIElement): void {
        const children = [...this.getChildren()];
        this.onDidConnect(root);
        for (const child of children) {
            if (child.getParent() === this) child.fireDidConnect(root);
        }
    }

    private fireDidDisconnect(): void {
        const children = [...this.getChildren()];
        this.onDidDisconnect();
        for (const child of children) {
            if (child.getParent() === this) child.fireDidDisconnect();
        }
    }

    /**
     * Корень дерева — **производный** от цепочки родителей: прогулка вверх до
     * вершины; если вершина — якорь (setAsRoot), это и есть корень, иначе
     * поддерево отсоединено и корня нет. Раньше root был кэшем, который
     * пропагировался вниз через getChildren() при setParent — контейнеры,
     * прячущие детей из getChildren() (неактивные вкладки), оставляли их с
     * протухшим null-root навсегда (семейство багов #204: focus()/open()
     * молча не работали). Живая цепочка родителей протухнуть не может.
     */
    public getRoot(): TUIElement | null {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let current: TUIElement = this;
        while (current._parent !== null) {
            current = current._parent;
        }
        return current.isRootAnchor ? current : null;
    }

    /**
     * Ближайший overlay-слой вверх по дереву (попапы, контекстные меню,
     * докнутые виджеты). Элементы-хосты слоёв (BodyElement, OverlayHostElement)
     * переопределяют и возвращают свой слой.
     */
    public getOverlayLayer(): OverlayLayer | null {
        return this.getParent()?.getOverlayLayer() ?? null;
    }

    /**
     * Sets this element as the root (used for testing and by BodyElement).
     * Помечает элемент якорем — getRoot() признаёт корнем только вершину
     * цепочки с этой меткой. Уже собранное поддерево получает
     * {@link onDidConnect} (поздний setAsRoot легален); повторный вызов —
     * no-op; якорь на узле с родителем запрещён (getRoot() не видит якорь в
     * середине цепочки — сработал бы только после detach, миной).
     */
    public setAsRoot(): void {
        if (this.isRootAnchor) return;
        if (this._parent !== null) {
            throw new Error("TUIElement.setAsRoot: якорь корня допустим только на вершине цепочки (без родителя)");
        }
        this.isRootAnchor = true;
        this.fireDidConnect(this);
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
        return child.layout(constraints);
    }

    /**
     * Единственный публичный вход в layout — НЕ переопределять (переопределяется
     * {@link performLayout}). Запоминает входные constraints (их читает
     * геометрическая проверка validateTree) и следит за контрактом: размер после
     * layout обязан удовлетворять constraints. «Контент не влез» — вопрос
     * отрисовки (клип), а не геометрии; занимать меньше выделенного можно только
     * под loose-constraints родителя. См. docs/LAYOUT.md, «Контракт performLayout».
     */
    public layout(constraints: BoxConstraints): Size {
        this.lastConstraintsValue = constraints;
        const result = this.performLayout(constraints);
        if (!constraints.isSatisfiedBy(result)) {
            throw new Error(
                `${this.constructor.name}: performLayout вернул ${result.width}×${result.height}, ` +
                    `нарушив constraints [${constraints.minWidth}..${constraints.maxWidth}]×` +
                    `[${constraints.minHeight}..${constraints.maxHeight}]`,
            );
        }
        if (result.width !== this.allocatedSize.width || result.height !== this.allocatedSize.height) {
            throw new Error(
                `${this.constructor.name}: performLayout вернул ${result.width}×${result.height}, ` +
                    `но записал allocatedSize ${this.allocatedSize.width}×${this.allocatedSize.height}`,
            );
        }
        return result;
    }

    /** Constraints последнего layout() — null, если layout ещё не вызывался. */
    public get lastLayoutConstraints(): BoxConstraints | null {
        return this.lastConstraintsValue;
    }

    private lastConstraintsValue: BoxConstraints | null = null;

    /**
     * Переопределяемая реализация layout: применяет constraints к выделенной
     * области. Вызывается ТОЛЬКО из {@link layout} — снаружи зовите layout().
     */
    protected performLayout(constraints: BoxConstraints): Size {
        const resultSize = constraints.constrain(this.allocatedSize);
        this.allocatedSize = resultSize;
        this.isLayoutDirty = false;
        return resultSize;
    }

    /**
     * Дефолт: отрисовать детей (лист без детей не рисует ничего). Контейнер,
     * которому нужно собственное полотно (фон, рамка, заголовок), рисует его и
     * зовёт {@link renderChildren}; полностью кастомный рендер (виртуализация,
     * скролл-сдвиг) переопределяет метод целиком.
     */
    public render(context: RenderContext): void {
        this.renderChildren(context);
    }

    /**
     * Каноничная отрисовка детей: каждый видимый ребёнок получает контекст со
     * сдвигом на свою localPosition и клипом по своим границам (дети не рисуют
     * за пределами выделенной области). Скрытые (hidden) пропускаются. Это тот
     * самый цикл, который раньше был скопирован в десяток контейнеров.
     */
    protected renderChildren(context: RenderContext): void {
        for (const child of this.getChildren()) {
            if (child.hidden) continue;
            const offset = new Offset(child.localPosition.dx, child.localPosition.dy);
            const clip = new Rect(child.globalPosition, child.layoutSize);
            child.render(context.withOffset(offset).withClip(clip));
        }
    }

    // ─── Hit-testing ───
    //
    // Правило системы (Н6): рендер и Tab обходят детей ВПЕРЁД, хит-тест — тем
    // же списком НАЗАД (последний нарисован сверху). Правило зашито в шаблон
    // ниже и не переопределяется; контейнер объявляет отличия только в двух
    // симметричных точках — {@link hitTestChildren} (зеркало
    // {@link renderChildren}) и {@link hitTestSelf}.

    /**
     * Финальный шаблон хит-теста — НЕ переопределять (кастомизация — через
     * {@link hitTestChildren}/{@link hitTestSelf}): скрытое не кликается,
     * вне собственных границ хита нет (инвариант вложенности Н2 гарантирует,
     * что и у детей его там нет), дети опрашиваются в обратном порядке
     * отрисовки, затем — сам элемент.
     */

    public elementFromPoint(point: Point): TUIElement | null {
        if (this.hidden) return null; // скрытое не кликается
        const bounds = new Rect(this.globalPosition, this.layoutSize);
        if (!bounds.containsPoint(point)) return null;

        const hit = this.hitTestChildren(point);
        if (hit) return hit;

        return this.hitTestSelf(point) ? this : null;
    }

    /**
     * Хит-тест детей — зеркало {@link renderChildren}: тот же список, обратный
     * порядок (верхний — первый), скрытых пропускает сам elementFromPoint
     * ребёнка. Переопределение — для контейнеров с осознанно другой политикой:
     * презентационные строки ListViewElement (`null` — мышь у контейнера),
     * modal-хвост OverlayLayer.
     */
    protected hitTestChildren(point: Point): TUIElement | null {
        const children = this.getChildren();
        for (let i = children.length - 1; i >= 0; i--) {
            const hit = children[i].elementFromPoint(point);
            if (hit) return hit;
        }
        return null;
    }

    /**
     * Берёт ли элемент точку на себя, когда никто из детей её не взял.
     * Дефолт — да (непрозрачный бокс). `false` — прозрачный для кликов
     * контейнер: точка проваливается к элементам ПОД ним (OverlayLayer без
     * попапа в этой точке).
     */
    protected hitTestSelf(_point: Point): boolean {
        return true;
    }

    // ─── Query API (querySelector / querySelectorAll) ───

    public querySelector(selector: string): TUIElement | null {
        return querySelector(this, selector);
    }

    public querySelectorAll(selector: string): TUIElement[] {
        return querySelectorAll(this, selector);
    }
}
