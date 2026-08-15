import { BoxConstraints, type Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { IViewTitleAction } from "./viewTitleRowElement.ts";
import { ViewTitleRowElement } from "./viewTitleRowElement.ts";

/** Экранная точка для якоря меню секции (куда откроется popup). */
export interface IPaneMenuAnchor {
    readonly screenX: number;
    readonly screenY: number;
}

/**
 * Заголовок view-секции сайдбара ({@link PaneViewElement}): общая строка
 * заголовка ({@link ViewTitleRowElement}) плюс жесты секции. Дети —
 * презентационные: хит-тест всегда возвращает сам заголовок (как строки
 * ListViewElement), потому что pointer capture работает только когда захватчик
 * — цель хит-теста; попадание по кнопке считает {@link ViewTitleRowElement.hitZone}.
 *
 * Заголовок — одновременно и drag-handle границы над собой (аналог
 * {@link SashElement}, отдельный сэш-ряд съел бы строку): пока зажата левая
 * кнопка, capture шлёт move/up сюда, и сдвиг по Y репортится наверх через
 * {@link onDrag}. Клик без сдвига — {@link onToggle} (либо {@link onAction} /
 * {@link onMenu}, если попал в кнопку); работать надо на сырых mousedown/up,
 * потому что capture синтезирует `click` даже после drag. Клавиатура:
 * Enter/Space — toggle, Shift+F10/правый клик — единое событие `contextmenu`
 * движка → {@link onMenu}.
 */
export class PaneHeaderElement extends TUIElement {
    /** Клик по заголовку вне кнопок (без drag) — свернуть/развернуть секцию. */
    public onToggle?: () => void;
    /** Перетаскивание границы: абсолютная экранная строка, куда тянут верх заголовка. */
    public onDrag?: (boundaryScreenY: number) => void;
    /** Запрос меню секции (кнопка «⋯», правый клик или Shift+F10). */
    public onMenu?: (anchor: IPaneMenuAnchor) => void;
    /** Клик по inline-кнопке заголовка. */
    public onAction?: (actionId: string) => void;

    private readonly row: ViewTitleRowElement;
    private readonly collapsible: boolean;
    private dragEnabled = false;

    // Состояние нажатия для различения click/drag (см. док-коммент класса).
    private pressed = false;
    private dragMoved = false;
    private pressScreenX = 0;
    private pressScreenY = 0;
    private pressLocalX = 0;

    public constructor(title: string, options?: { collapsible?: boolean }) {
        super();
        this.collapsible = options?.collapsible ?? true;
        this.focusable = true;
        this.capturesPointer = true;
        // Цвета покоя наследуются от вьюлета (sideBar.*) — как в VS Code, где
        // sideBarSectionHeader.background прозрачен; свой токен не берём, потому
        // что альфа при парсинге тем отбрасывается и «прозрачный» из dark+
        // выродился бы в чёрный.
        this.style = { when: [{ states: ["focus"], bg: "list.hoverBackground" }] };

        // Несворачиваемый заголовок (merged одно-view контейнер) — без шеврона.
        this.row = new ViewTitleRowElement(title, { chevron: this.collapsible });
        this.appendChild(this.row);

        this.addEventListener("mousedown", (event) => {
            if (event.button !== "left") return;
            this.pressed = true;
            this.dragMoved = false;
            this.pressScreenX = event.screenX;
            this.pressScreenY = event.screenY;
            this.pressLocalX = event.localX;
        });
        this.addEventListener("mousemove", (event) => {
            this.row.setHoveredZone(this.row.hitZone(event.localX));
            if (!this.pressed) return;
            if (!this.dragMoved && event.screenY === this.pressScreenY) return;
            // Любой сдвиг по Y — это drag: отпускание больше не считается кликом,
            // даже если ресайз в эту сторону запрещён.
            this.dragMoved = true;
            if (this.dragEnabled) this.onDrag?.(event.screenY);
        });
        this.addEventListener("mouseup", (event) => {
            if (!this.pressed) return;
            this.pressed = false;
            if (this.dragMoved || event.defaultPrevented) return;
            const zone = this.row.hitZone(this.pressLocalX);
            if (zone.kind === "menu") {
                this.onMenu?.({ screenX: this.pressScreenX, screenY: this.pressScreenY });
            } else if (zone.kind === "action") {
                this.onAction?.(zone.actionId);
            } else if (this.collapsible) {
                this.onToggle?.();
            }
        });
        this.addEventListener("mouseleave", () => {
            this.row.setHoveredZone(null);
        });
        this.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            const menuEvent = event as TUIContextMenuEvent;
            const anchor =
                menuEvent.trigger === "keyboard"
                    ? this.menuZoneAnchor()
                    : { screenX: menuEvent.screenX, screenY: menuEvent.screenY };
            this.onMenu?.(anchor);
        });
    }

    public get isExpanded(): boolean {
        return this.row.isExpanded;
    }

    public setExpanded(expanded: boolean): void {
        this.row.setExpanded(expanded);
    }

    public setTitle(title: string): void {
        this.row.setTitle(title);
    }

    /** Inline-кнопки заголовка (группа `navigation` меню секции). */
    public setActions(actions: readonly IViewTitleAction[]): void {
        this.row.setActions(actions);
    }

    /** Произвольный контрол в заголовке (переключатель каналов Output). */
    public setTitleWidget(widget: TUIElement | null): void {
        this.row.setTitleWidget(widget);
    }

    /** Прятать ли «⋯» (см. {@link ViewTitleRowElement.setMenuVisible}). */
    public setMenuVisible(visible: boolean): void {
        this.row.setMenuVisible(visible);
    }

    /** Контейнер отключает drag, когда выше/ниже нет развёрнутой секции. */
    public setDragEnabled(enabled: boolean): void {
        this.dragEnabled = enabled;
    }

    public get isDragEnabled(): boolean {
        return this.dragEnabled;
    }

    private menuZoneAnchor(): IPaneMenuAnchor {
        return {
            screenX: this.globalPosition.x + this.row.menuAnchorX,
            screenY: this.globalPosition.y,
        };
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return 1;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        this.layoutChild(this.row, 0, 0, BoxConstraints.tight(size));
        return size;
    }

    protected override hitTestChildren(point: Point): TUIElement | null {
        // Лейблы презентационные: их мышь принадлежит заголовку — иначе pointer
        // capture (drag границы) не сработает, когда нажатие пришлось на лейбл.
        // Виджет заголовка — исключение: это настоящий контрол, ему мышь нужна.
        return this.row.hitTestWidget(point);
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type !== "keydown") return;
        const keyEvent = event as TUIKeyboardEvent;
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
            event.preventDefault();
            if (this.collapsible) this.onToggle?.();
        }
    }

    public override inspectState(): Record<string, unknown> {
        return {
            title: this.row.getTitle(),
            expanded: this.row.isExpanded,
            dragEnabled: this.dragEnabled,
            collapsible: this.collapsible,
        };
    }
}
