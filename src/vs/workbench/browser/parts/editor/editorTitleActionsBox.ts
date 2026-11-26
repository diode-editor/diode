import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { TAB_HEIGHT } from "@tuidom/elements/editorgroup/editorTabItemElement";

const LABEL_ROW = 1;
const BASELINE_ROW = TAB_HEIGHT - 1;

/**
 * The editor title buttons beside the tabs, as tall as a tab: the buttons on the tabs' label row,
 * the workbench surface above, and below them the tabs' baseline — the editor frame's top line —
 * running on to the frame's top-right corner `╮`, which the tab strip leaves to it.
 */
export class EditorTitleActionsBox extends TUIElement {
    public constructor(private readonly actions: TUIElement) {
        super();
        this.style = { bg: "editorGroupHeader.tabsBackground" };
        this.appendChild(actions);
    }

    public override getMinIntrinsicWidth(height: number): number {
        return this.actions.getMinIntrinsicWidth(height);
    }

    public override getMaxIntrinsicWidth(height: number): number {
        return this.actions.getMaxIntrinsicWidth(height);
    }

    public override getMinIntrinsicHeight(): number {
        return TAB_HEIGHT;
    }

    public override getMaxIntrinsicHeight(): number {
        return TAB_HEIGHT;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const rows = Math.max(0, Math.min(1, size.height - LABEL_ROW));
        this.layoutChild(this.actions, 0, LABEL_ROW, BoxConstraints.tight(new Size(size.width, rows)));
        return size;
    }

    public override render(context: RenderContext): void {
        this.paintOwnBackground(context);
        this.renderChildren(context);
        const { width, height } = this.layoutSize;
        if (height <= BASELINE_ROW) return;
        // The editor group's frame line, on the tab strip's baseline surface.
        const fg = this.styleVar("panel.border");
        const bg = this.styleVar("tab.activeBackground");
        for (let x = 0; x < width; x++) {
            context.setCell(x, BASELINE_ROW, { char: x === width - 1 ? "╮" : "─", fg, bg });
        }
    }
}
