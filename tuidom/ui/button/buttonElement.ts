import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import type { TUIEventBase } from "../../dom/events/tuiEventBase.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

export interface IButtonStyles {
    readonly fg: number;
    readonly bg: number;
    readonly hoverBg: number;
    readonly focusedFg: number;
    readonly focusedBg: number;
    readonly focusedHoverBg: number;
}

// Defaults preserve the historical look; owners (e.g. a dialog) override them via setStyles.
export const unthemedButtonStyles: IButtonStyles = {
    fg: packRgb(204, 204, 204),
    bg: packRgb(60, 60, 60),
    hoverBg: packRgb(69, 73, 78),
    focusedFg: packRgb(255, 255, 255),
    focusedBg: packRgb(0, 120, 215),
    focusedHoverBg: packRgb(26, 134, 224),
};

export class ButtonElement extends TUIElement {
    public onActivate?: () => void;

    private styles: IButtonStyles = unthemedButtonStyles;
    private readonly label: string;
    private hovered = false;

    public constructor(label: string, options?: { styles?: IButtonStyles }) {
        super();
        this.label = label;
        this.focusable = true;
        if (options?.styles) {
            this.styles = options.styles;
        }

        this.addEventListener("focus", () => {
            this.markDirty();
        });
        this.addEventListener("blur", () => {
            this.markDirty();
        });
        this.addEventListener("click", (event) => {
            if (event.defaultPrevented) return;
            this.onActivate?.();
        });
        this.addEventListener("mouseenter", () => {
            if (this.hovered) return;
            this.hovered = true;
            this.markDirty();
        });
        this.addEventListener("mouseleave", () => {
            if (!this.hovered) return;
            this.hovered = false;
            this.markDirty();
        });
    }

    public getLabel(): string {
        return this.label;
    }

    public setStyles(styles: IButtonStyles): void {
        this.styles = styles;
        this.markDirty();
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return this.label.length + 4;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.label.length + 4;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return 1;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const natural = new Size(this.getMaxIntrinsicWidth(1), this.getMaxIntrinsicHeight(0));
        return super.performLayout(BoxConstraints.tight(constraints.constrain(natural)));
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type !== "keydown") return;
        const keyEvent = event as TUIKeyboardEvent;
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
            event.preventDefault();
            this.onActivate?.();
        }
    }

    public override render(context: RenderContext): void {
        const focused = this.isFocused;
        const fg = focused ? this.styles.focusedFg : this.styles.fg;
        const bg = focused
            ? this.hovered
                ? this.styles.focusedHoverBg
                : this.styles.focusedBg
            : this.hovered
              ? this.styles.hoverBg
              : this.styles.bg;
        context.drawText(0, 0, `[ ${this.label} ]`, { fg, bg }, { maxWidth: this.layoutSize.width });
    }
}
