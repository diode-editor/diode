import { BoxConstraints, type Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { IViewTitleAction } from "./viewTitleRowElement.ts";
import { ViewTitleRowElement } from "./viewTitleRowElement.ts";

export interface IPaneMenuAnchor {
    readonly screenX: number;
    readonly screenY: number;
}

/**
 * Дети презентационные: хит-тест всегда возвращает сам заголовок, потому что pointer capture
 * работает, только когда захватчик — цель хит-теста; попадание по кнопке считает
 * {@link ViewTitleRowElement.hitZone}.
 *
 * Заголовок — и drag-handle границы над собой (отдельный сэш-ряд съел бы строку). Клик и
 * drag различаются на сырых mousedown/up: capture синтезирует `click` даже после drag.
 */
export class PaneHeaderElement extends TUIElement {
    public onToggle?: () => void;
    /** Абсолютная экранная строка, куда тянут верх заголовка. */
    public onDrag?: (boundaryScreenY: number) => void;
    public onMenu?: (anchor: IPaneMenuAnchor) => void;
    public onAction?: (actionId: string) => void;

    private readonly row: ViewTitleRowElement;
    private readonly collapsible: boolean;
    private dragEnabled = false;

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
        // Фон покоя наследуется от вьюлета, как в VS Code с прозрачным sideBarSectionHeader.background:
        // альфа при парсинге тем отбрасывается, и «прозрачный» из dark+ выродился бы в чёрный.
        this.style = {
            fg: this.collapsible ? "sideBarSectionHeader.foreground" : "sideBarTitle.foreground",
            when: [{ states: ["focus"], bg: "list.hoverBackground" }],
        };

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
            // Любой сдвиг по Y — drag, даже если ресайз в эту сторону запрещён.
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

    public setActions(actions: readonly IViewTitleAction[]): void {
        this.row.setActions(actions);
    }

    public setTitleWidget(widget: TUIElement | null): void {
        this.row.setTitleWidget(widget);
    }

    public setSpinnerFrame(frame: string | null): void {
        this.row.setSpinnerFrame(frame);
    }

    public setMenuVisible(visible: boolean): void {
        this.row.setMenuVisible(visible);
    }

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
        // Мышь лейблов принадлежит заголовку (pointer capture drag'а); виджет — настоящий контрол.
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
            busy: this.row.isBusy,
        };
    }
}
