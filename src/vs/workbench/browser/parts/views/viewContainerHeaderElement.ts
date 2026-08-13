import { BoxConstraints, type Point, Size } from "@tuidom/all/common/geometryPromitives";
import type { TUIContextMenuEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import { TUIElement } from "@tuidom/all/dom/tuiElement";

import type { IPaneMenuAnchor } from "./paneHeaderElement.ts";
import type { IViewTitleAction } from "./viewTitleRowElement.ts";
import { ViewTitleRowElement } from "./viewTitleRowElement.ts";

/**
 * Заголовок контейнера view-секций («активити»): та же строка заголовка, что у
 * секции ({@link ViewTitleRowElement}), но без шеврона и без drag границы —
 * контейнер не сворачивается. Заменил `TitledPanelElement`, у которого была
 * только надпись: контейнеру нужны inline-действия и меню «⋯» с
 * переключателем видимости секций.
 *
 * Мышь по лейблам принадлежит заголовку, как у {@link PaneHeaderElement} —
 * попадание по кнопке считает {@link ViewTitleRowElement.hitZone}, и у обоих
 * заголовков одна геометрия кнопок. Исключение — виджет заголовка: он
 * настоящий контрол (селектор каналов Output), клики обязаны доходить до него.
 */
export class ViewContainerHeaderElement extends TUIElement {
    /** Запрос меню контейнера (кнопка «⋯», правый клик или Shift+F10). */
    public onMenu?: (anchor: IPaneMenuAnchor) => void;
    /** Клик по inline-кнопке заголовка. */
    public onAction?: (actionId: string) => void;

    private readonly row: ViewTitleRowElement;
    private pressed = false;
    private pressScreenX = 0;
    private pressScreenY = 0;
    private pressLocalX = 0;

    public constructor(title: string) {
        super();
        this.focusable = true;
        this.style = {
            fg: "titledPanel.titleForeground",
            when: [{ states: ["focus"], bg: "list.hoverBackground" }],
        };
        this.row = new ViewTitleRowElement(title, { chevron: false });
        this.appendChild(this.row);

        this.addEventListener("mousedown", (event) => {
            if (event.button !== "left") return;
            this.pressed = true;
            this.pressScreenX = event.screenX;
            this.pressScreenY = event.screenY;
            this.pressLocalX = event.localX;
        });
        this.addEventListener("mouseup", (event) => {
            if (!this.pressed) return;
            this.pressed = false;
            if (event.defaultPrevented) return;
            const zone = this.row.hitZone(this.pressLocalX);
            if (zone.kind === "menu") {
                this.onMenu?.({ screenX: this.pressScreenX, screenY: this.pressScreenY });
            } else if (zone.kind === "action") {
                this.onAction?.(zone.actionId);
            }
        });
        this.addEventListener("mousemove", (event) => {
            this.row.setHoveredZone(this.row.hitZone(event.localX));
        });
        this.addEventListener("mouseleave", () => {
            this.row.setHoveredZone(null);
        });
        this.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            const menuEvent = event as TUIContextMenuEvent;
            const anchor =
                menuEvent.trigger === "keyboard"
                    ? { screenX: this.globalPosition.x + this.row.menuAnchorX, screenY: this.globalPosition.y }
                    : { screenX: menuEvent.screenX, screenY: menuEvent.screenY };
            this.onMenu?.(anchor);
        });
    }

    public setTitle(title: string): void {
        this.row.setTitle(title);
    }

    public setActions(actions: readonly IViewTitleAction[]): void {
        this.row.setActions(actions);
    }

    /** Произвольный контрол слева от кнопок (переключатель каналов Output). */
    public setTitleWidget(widget: TUIElement | null): void {
        this.row.setTitleWidget(widget);
    }

    /** Прятать ли «⋯» (см. {@link ViewTitleRowElement.setMenuVisible}). */
    public setMenuVisible(visible: boolean): void {
        this.row.setMenuVisible(visible);
    }

    /** Ширина содержимого: полосе контролов в таб-строке панели её назначает контейнер. */
    public override getMaxIntrinsicWidth(height: number): number {
        return this.row.getMaxIntrinsicWidth(height);
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
        // Лейблы презентационные (их клики считает hitZone), но виджет в
        // заголовке — настоящий контрол, и мышь должна доходить до него.
        return this.row.hitTestWidget(point);
    }

    public override inspectState(): Record<string, unknown> {
        return { title: this.row.getTitle() };
    }
}
