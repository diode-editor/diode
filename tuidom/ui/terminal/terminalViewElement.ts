// Контрол отрисовки терминала — «клиент» встроенного терминала.
//
// TUIElement-лист: каждый кадр читает абстрактную сетку ячеек через `ITerminalSurface`
// и блитит её в наш grid через `RenderContext.setCell`. Виджет НЕ знает про PTY/эмулятор:
// вся связка (node-pty + @xterm/headless) живёт за `ITerminalSurface` на слое Workbench,
// поэтому TUIDom остаётся чистым (без импортов @xterm/headless и node-pty).
// Размером PTY управляет по реально выделенному месту (`performLayout` → `surface.resize`),
// поэтому ресайз окна автоматически рефлоует шелл. Ввод пробрасывает в surface через
// `encodeKeyForPty`. Колесо и Shift+PageUp/PageDown крутят вьюпорт по скролбэку
// (`surface.scrollLines`), пока программа в шелле не включила свой mouse-tracking —
// тогда колесо целиком её. См. docs/TODO/IntegratedTerminal.md.

import { DEFAULT_COLOR } from "../../common/colorUtils.ts";
import type { IDisposable } from "../../common/disposable.ts";
import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import type {
    ITerminalSurface,
    TerminalCell,
    TerminalMouseAction,
    TerminalMouseButton,
} from "../../common/iTerminalSurface.ts";
import type { TUIEventBase } from "../../dom/events/tuiEventBase.ts";
import type { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import type { TUIMouseEvent, WheelDirection } from "../../dom/events/tuiMouseEvent.ts";
import type { TUIPasteEvent } from "../../dom/events/tuiPasteEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

import { encodeKeyForPty } from "./encodeKeyForPty.ts";

// wheelDirection ("up"|"down"|"left"|"right") → семантический action поверхности.
// Ключи типизированы точно (WheelDirection, а не string) — индексация тотальна,
// недостижимый фоллбэк на «неизвестное» направление не нужен.
const WHEEL_ACTION: Record<WheelDirection, TerminalMouseAction> = {
    up: "wheelUp",
    down: "wheelDown",
    left: "wheelLeft",
    right: "wheelRight",
};

// Локальная прокрутка вьюпорта колесом: строк на «щелчок» и знак направления.
// Горизонтальные направления дают 0 — скролбэк одномерный, крутить вбок нечего.
const WHEEL_SCROLL_LINES = 3;
const WHEEL_SCROLL_SIGN: Record<WheelDirection, number> = { up: -1, down: 1, left: 0, right: 0 };

export class TerminalViewElement extends TUIElement {
    private readonly surface: ITerminalSurface;
    // Переиспользуемая ячейка — readCell(x, y, cell) не аллоцирует новый объект на каждую ячейку.
    private readonly cell: TerminalCell = { char: " ", fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, style: 0, width: 1 };
    // Подписки на поверхность — TUIElement не имеет lifecycle-хука, поэтому храним их сами
    // и рвём в dispose() (владелец виджета — контроллер — обязан его вызвать).
    private readonly subscriptions: IDisposable[] = [];

    // Цвета «по умолчанию», которыми заменяем DEFAULT_COLOR ячеек при блите. Контроллер
    // пушит сюда цвета темы (как EditorElement/PanelContainerElement получают цвета извне).

    public constructor(surface: ITerminalSurface) {
        super();
        // Дефолтные цвета терминала — токены темы (фоллбэки panel/editor — в пуше палитры).
        this.style = { fg: "terminal.foreground", bg: "terminal.background" };
        this.surface = surface;
        this.focusable = true; // фокусируемый — принимает клавиатуру
        this.capturesPointer = true; // drag: move/up приходят сюда даже вне границ

        // Новые данные из шелла → перерисовать контрол (TuiApplication батчит кадр).
        this.subscriptions.push(
            this.surface.onUpdate(() => {
                this.markDirty();
            }),
        );
        // Выход шелла тоже перерисовывает — чтобы спрятать курсор (isExited в render).
        this.subscriptions.push(
            this.surface.onExit(() => {
                this.markDirty();
            }),
        );

        // Мышь → surface (эмулятор сам решает по активному mouse-режиму, слать ли отчёт).
        this.addEventListener("mousedown", (event) => {
            this.forwardMouse(event, "down");
        });
        this.addEventListener("mouseup", (event) => {
            this.forwardMouse(event, "up");
        });
        this.addEventListener("mousemove", (event) => {
            this.forwardMouse(event, "move");
        });
        this.addEventListener("wheel", (event) => {
            const mouse = event;
            // Колесо без направления (бэкенд его не распознал) трактуем как прокрутку вверх.
            const direction = mouse.wheelDirection ?? "up";
            // Программа включила mouse-tracking (htop/vim/less --mouse) — колесо её,
            // отдаём отчёт как есть. Обычный шелл mouse-режимов не включает, и тогда
            // колесо наше: крутим вьюпорт по скролбэку (как xterm.js/VS Code).
            if (this.surface.mouseEventsActive) {
                this.sendMouse(mouse, "wheel", WHEEL_ACTION[direction]);
                return;
            }
            const sign = WHEEL_SCROLL_SIGN[direction];
            if (sign === 0) return;
            mouse.preventDefault();
            this.surface.scrollLines(sign * WHEEL_SCROLL_LINES);
        });
    }

    /** Рвёт подписки на поверхность. Вызывается владельцем виджета (контроллером). */
    public dispose(): void {
        for (const sub of this.subscriptions) sub.dispose();
        this.subscriptions.length = 0;
    }

    private forwardMouse(event: TUIMouseEvent, action: TerminalMouseAction): void {
        this.sendMouse(event, event.button, action);
    }

    private sendMouse(event: TUIMouseEvent, button: TerminalMouseButton, action: TerminalMouseAction): void {
        this.surface.sendMouse({
            col: event.localX,
            row: event.localY,
            button,
            action,
            ctrl: event.ctrlKey,
            alt: event.altKey,
            shift: event.shiftKey,
        });
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        // Держим PTY и эмулятор ровно по выделенной области (TIOCSWINSZ+SIGWINCH).
        this.surface.resize(size.width, size.height);
        return size;
    }

    public override render(context: RenderContext): void {
        const width = this.layoutSize.width;
        const height = this.layoutSize.height;
        const cell = this.cell;

        for (let y = 0; y < height; y++) {
            // readCell отдаёт false и для continuation-ячейки wide-char, и для координаты
            // вне диапазона. Различаем по предыдущей ячейке: после width=2 следующий false —
            // это continuation (голова уже нарисована с шириной 2), пропускаем без покраски;
            // иначе это пустая/внедиапазонная ячейка — красим пробелом, чтобы область виджета
            // была закрашена полностью.
            let prevWasWide = false;
            for (let x = 0; x < width; x++) {
                if (this.surface.readCell(x, y, cell)) {
                    context.setCell(x, y, {
                        char: cell.char,
                        fg: cell.fg === DEFAULT_COLOR ? this.resolvedStyle.fg : cell.fg,
                        bg: cell.bg === DEFAULT_COLOR ? this.resolvedStyle.bg : cell.bg,
                        style: cell.style,
                        width: cell.width,
                    });
                    prevWasWide = cell.width === 2;
                } else if (prevWasWide) {
                    prevWasWide = false; // continuation wide-char — пропускаем
                } else {
                    context.setCell(x, y, { char: " " }); // пустая/вне диапазона
                }
            }
        }

        // Курсор PTY показываем только когда контрол в фокусе и шелл жив.
        if (this.isFocused && !this.surface.isExited) {
            const cursor = this.surface.getCursor();
            if (cursor !== null && cursor.x >= 0 && cursor.x < width && cursor.y >= 0 && cursor.y < height) {
                context.setCursorPosition(cursor.x, cursor.y);
            }
        }
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type === "paste") {
            event.preventDefault();
            this.surface.write((event as TUIPasteEvent).text);
            return;
        }
        if (event.type === "keydown") {
            const key = event as TUIKeyboardEvent;
            // Shift+PageUp/PageDown — клавиатурный аналог колеса: листаем скролбэк
            // страницами, в PTY эти сочетания не уходят.
            if (key.shiftKey && (key.key === "PageUp" || key.key === "PageDown")) {
                event.preventDefault();
                const page = Math.max(1, this.layoutSize.height - 1);
                this.surface.scrollLines(key.key === "PageUp" ? -page : page);
                return;
            }
            const bytes = encodeKeyForPty(key);
            if (bytes !== "") {
                event.preventDefault();
                this.surface.write(bytes);
            }
            return;
        }
        // Всё остальное (в т.ч. mousedown) → базовое поведение: клик по фокусируемому
        // элементу переводит на него фокус (TUIElement.performDefaultAction).
        super.performDefaultAction(event);
    }
}
