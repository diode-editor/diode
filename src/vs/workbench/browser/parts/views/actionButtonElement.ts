import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { type RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";

/**
 * The full-width button of a view: Source Control's Commit, the Run and Debug welcome. Not `ButtonElement`: that
 * one needs an immutable label and natural width, here the text changes and is centered across the full width.
 */
export class ActionButtonElement extends TUIElement {
    public onActivate?: () => void;

    private label = "";
    private disabledState = false;

    public constructor() {
        super();
        this.focusable = true;
        this.style = {
            fg: "button.foreground",
            bg: "button.background",
            when: [
                { states: ["hover"], bg: "button.hoverBackground" },
                { states: ["focus"], bg: "button.hoverBackground" },
            ],
        };
        this.addEventListener("click", (event) => {
            if (event.defaultPrevented || this.disabledState) return;
            this.onActivate?.();
        });
    }

    public getLabel(): string {
        return this.label;
    }

    public setLabel(label: string): void {
        this.label = label;
        this.markDirty();
    }

    public isDisabled(): boolean {
        return this.disabledState;
    }

    public setDisabled(disabled: boolean): void {
        this.disabledState = disabled;
        this.focusable = !disabled;
        this.markDirty();
    }

    public override inspectState(): Record<string, unknown> {
        return { label: this.label, disabled: this.disabledState, hidden: this.hidden };
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return 1;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const width = Number.isFinite(constraints.maxWidth) ? constraints.maxWidth : constraints.minWidth;
        return super.performLayout(BoxConstraints.tight(constraints.constrain(new Size(width, 1))));
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type !== "keydown") return;
        const keyEvent = event as TUIKeyboardEvent;
        if ((keyEvent.key === "Enter" || keyEvent.key === " ") && !this.disabledState) {
            event.preventDefault();
            this.onActivate?.();
        }
    }

    public override render(context: RenderContext): void {
        const { fg, bg } = this.resolvedStyle;
        const colors = this.disabledState
            ? { fg: this.styleVar("button.secondaryForeground"), bg: this.styleVar("button.secondaryBackground") }
            : { fg, bg };
        const width = this.layoutSize.width;
        context.drawText(0, 0, " ".repeat(width), colors);
        context.drawText(Math.max(0, Math.floor((width - this.label.length) / 2)), 0, this.label, colors);
    }
}
