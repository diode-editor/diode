import { BoxConstraints, type Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { IPaneMenuAnchor } from "./paneHeaderElement.ts";
import type { IViewTitleAction } from "./viewTitleRowElement.ts";
import { ViewTitleRowElement } from "./viewTitleRowElement.ts";

/**
 * No chevron and no boundary drag: the container doesn't collapse. Mouse input on the labels belongs
 * to the header, as in {@link PaneHeaderElement}; the header widget is the exception.
 */
export class ViewContainerHeaderElement extends TUIElement {
    public onMenu?: (anchor: IPaneMenuAnchor) => void;
    public onAction?: (actionId: string) => void;
    public onSwitch?: (anchor: IPaneMenuAnchor) => void;

    private readonly row: ViewTitleRowElement;
    private pressed = false;
    private pressScreenX = 0;
    private pressScreenY = 0;
    private pressLocalX = 0;

    public constructor(title: string) {
        super();
        this.focusable = true;
        this.style = {
            fg: "sideBarTitle.foreground",
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
            } else if (zone.kind === "switcher") {
                this.onSwitch?.(this.switcherAnchor());
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

    public setSwitcher(enabled: boolean): void {
        this.row.setSwitcher(enabled);
    }

    public setActions(actions: readonly IViewTitleAction[]): void {
        this.row.setActions(actions);
    }

    public setTitleWidget(widget: TUIElement | null): void {
        this.row.setTitleWidget(widget);
    }

    public setMenuVisible(visible: boolean): void {
        this.row.setMenuVisible(visible);
    }

    public setSpinnerFrame(frame: string | null): void {
        this.row.setSpinnerFrame(frame);
    }

    /** In the panel tab row, the container assigns the width of the controls strip. */
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
        return this.row.hitTestWidget(point);
    }

    /** Enter/Space on the focused header opens the switcher, as a click on the title does. */
    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type !== "keydown" || !this.row.hasSwitcher) return;
        const keyEvent = event as TUIKeyboardEvent;
        if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
        event.preventDefault();
        this.onSwitch?.(this.switcherAnchor());
    }

    /** The header's left edge: the dropdown opens under the title it belongs to. */
    private switcherAnchor(): IPaneMenuAnchor {
        return { screenX: this.globalPosition.x, screenY: this.globalPosition.y };
    }

    public override inspectState(): Record<string, unknown> {
        return { title: this.row.getTitle(), busy: this.row.isBusy };
    }
}
