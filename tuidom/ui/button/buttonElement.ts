import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import type { TUIEventBase } from "../../dom/events/tuiEventBase.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

export class ButtonElement extends TUIElement {
    public onActivate?: () => void;

    private readonly label: string;

    public constructor(label: string) {
        super();
        this.label = label;
        this.focusable = true;
        // Вся state-логика цвета — в when-вариантах: hover/focus ставит ядро,
        // "checked" (тумблеры) — setChecked. Порядок = приоритет: checked
        // объявлен ПОСЛЕ focus — включённый тумблер выглядит primary
        // независимо от фокуса.
        this.style = {
            fg: "button.secondaryForeground",
            bg: "button.secondaryBackground",
            when: [
                { states: ["hover"], bg: "button.secondaryHoverBackground" },
                { states: ["focus"], fg: "button.foreground", bg: "button.background" },
                { states: ["focus", "hover"], bg: "button.hoverBackground" },
                { states: ["checked"], fg: "button.foreground", bg: "button.background" },
                { states: ["checked", "hover"], bg: "button.hoverBackground" },
            ],
        };

        this.addEventListener("click", (event) => {
            if (event.defaultPrevented) return;
            this.onActivate?.();
        });
    }

    public getLabel(): string {
        return this.label;
    }

    /** Режим «включённого тумблера» (кнопки-переключатели поиска): primary-вид. */
    public setChecked(checked: boolean): void {
        this.setStyleState("checked", checked);
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
        const { fg, bg } = this.resolvedStyle;
        context.drawText(0, 0, `[ ${this.label} ]`, { fg, bg }, { maxWidth: this.layoutSize.width });
    }
}
