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
 * Children are presentational: hit testing always returns the header itself, because pointer capture
 * only works when the capturing element is the hit-test target; which button was hit is computed by
 * {@link ViewTitleRowElement.hitZone}.
 *
 * The header is also the drag handle for the boundary above it (a separate sash row would cost a line).
 * Click and drag are told apart on raw mousedown/up: capture synthesizes `click` even after a drag.
 */
export class PaneHeaderElement extends TUIElement {
    public onToggle?: () => void;
    /** Absolute screen row the top of the header is dragged to. */
    public onDrag?: (boundaryScreenY: number) => void;
    public onMenu?: (anchor: IPaneMenuAnchor) => void;
    public onAction?: (actionId: string) => void;
    public onSwitch?: (anchor: IPaneMenuAnchor) => void;

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
        // The idle background is inherited from the viewlet, like VS Code with a transparent
        // sideBarSectionHeader.background: theme parsing drops alpha, so dark+'s "transparent" would turn black.
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
            // Any Y movement is a drag, even if resizing in that direction is not allowed.
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
            } else if (zone.kind === "switcher") {
                this.onSwitch?.(this.switcherAnchor());
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

    public setDescription(description: string | null): void {
        this.row.setDescription(description);
    }

    public setNerdFont(nerdFont: boolean): void {
        this.row.setNerdFont(nerdFont);
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

    /** The header's left edge: the dropdown opens under the title it belongs to. */
    private switcherAnchor(): IPaneMenuAnchor {
        return { screenX: this.globalPosition.x, screenY: this.globalPosition.y };
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
        // Mouse input on the labels belongs to the header (drag pointer capture); the widget is a real control.
        return this.row.hitTestWidget(point);
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type !== "keydown") return;
        const keyEvent = event as TUIKeyboardEvent;
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
            event.preventDefault();
            if (this.collapsible) this.onToggle?.();
            else if (this.row.hasSwitcher) this.onSwitch?.(this.switcherAnchor());
        }
    }

    public override inspectState(): Record<string, unknown> {
        return {
            title: this.row.getTitle(),
            description: this.row.getDescription(),
            expanded: this.row.isExpanded,
            dragEnabled: this.dragEnabled,
            collapsible: this.collapsible,
            busy: this.row.isBusy,
        };
    }
}
