import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";

/**
 * Counterpart of an upstream `viewsWelcome` line. An empty line is a text block with `text: ""`: the
 * author places gaps, not the layout, otherwise "text, button below" and "text, gap, button" would be
 * indistinguishable.
 */
export type IViewWelcomeBlock =
    | { readonly kind: "text"; readonly text: string }
    | {
          readonly kind: "button";
          readonly label: string;
          readonly command: string;
          readonly args?: readonly unknown[];
      };

/**
 * Column of the section header and tree rows. The flat hint has no indent on purpose (in the
 * panel it would get cut off), but welcome text right at the edge reads poorly.
 */
const LEFT_PADDING = 1;

type WelcomeRow =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "button"; readonly index: number };

/**
 * Text is painted directly, not via child labels: wrapping depends on the width from `performLayout`,
 * and changing the children or an attached label's text there is not allowed, as it freezes the frame.
 * So the only children are buttons.
 */
export class ViewWelcomeElement extends TUIElement {
    private readonly buttons: ButtonElement[] = [];

    public constructor(
        private readonly blocks: readonly IViewWelcomeBlock[],
        run: (command: string, args: readonly unknown[]) => void,
    ) {
        super();
        this.style = { fg: "descriptionForeground" };
        for (const block of blocks) {
            if (block.kind !== "button") continue;
            const button = new ButtonElement(block.label);
            const { command, args = [] } = block;
            button.onActivate = () => {
                run(command, args);
            };
            this.buttons.push(button);
            this.appendChild(button);
        }
    }

    /** `false` when there are no buttons; the caller decides where focus goes. */
    public focusFirstButton(): boolean {
        const first = this.buttons.at(0);
        if (first === undefined) return false;
        first.focus();
        return true;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const width = this.textWidth(size.width);
        const rows = this.rowsFor(width);
        for (const [y, row] of rows.entries()) {
            if (row.kind !== "button") continue;
            this.layoutChild(this.buttons[row.index], LEFT_PADDING, y, BoxConstraints.loose(new Size(width, 1)));
        }
        return size;
    }

    public override render(context: RenderContext): void {
        super.render(context);
        const { fg, bg } = this.resolvedStyle;
        const width = this.textWidth(this.layoutSize.width);
        const rows = this.rowsFor(width);
        for (const [y, row] of rows.entries()) {
            if (row.kind !== "text") continue;
            // No `maxWidth`: lines are already wrapped to this width, the section clip cuts the rest.
            context.drawText(LEFT_PADDING, y, row.text, { fg, bg });
        }
    }

    private textWidth(available: number): number {
        return Math.max(0, available - LEFT_PADDING);
    }

    /** No cache: there are only a few blocks, and a per-width cache would add a branch observable only by cost. */
    private rowsFor(width: number): readonly WelcomeRow[] {
        const rows: WelcomeRow[] = [];
        let buttonIndex = 0;
        for (const block of this.blocks) {
            if (block.kind === "button") {
                rows.push({ kind: "button", index: buttonIndex });
                buttonIndex++;
                continue;
            }
            // A gap (`text: ""`): wrapText returns a single empty line for it.
            for (const line of wrapText(block.text, width)) rows.push({ kind: "text", text: line });
        }
        return rows;
    }
}
