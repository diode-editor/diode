import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import type { StyleColor, TUIStyle } from "../../dom/styles/tuiStyle.ts";
import { resolveStyleColor } from "../../dom/styles/tuiStyle.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

export interface TitledPanelStyle extends TUIStyle {
    panelTitleFg?: StyleColor;
}

const DEFAULT_PANEL_TITLE_FG = packRgb(130, 130, 130);

export class TitledPanelElement extends TUIElement<TitledPanelStyle> {
    private title: string;
    private child: TUIElement;
    private titlePaddingLeft: number;

    public constructor(title: string, child: TUIElement, options?: { titlePaddingLeft?: number }) {
        super();
        this.title = title;
        this.child = child;
        this.child.setParent(this);
        this.titlePaddingLeft = options?.titlePaddingLeft ?? 1;
    }

    public getTitle(): string {
        return this.title;
    }

    public setTitle(value: string): void {
        this.title = value;
        this.markDirty();
    }

    public override getChildren(): readonly TUIElement[] {
        return [this.child];
    }

    public override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        const childHeight = Math.max(0, containerSize.height - 1);

        this.layoutChild(this.child, 0, 1, BoxConstraints.tight(new Size(containerSize.width, childHeight)));

        return containerSize;
    }

    public override render(context: RenderContext): void {
        const width = this.layoutSize.width;
        const resolved = this.resolvedStyle;
        const titleFg =
            this.style.panelTitleFg !== undefined
                ? resolveStyleColor(this.style.panelTitleFg, resolved.fg, resolved.bg)
                : DEFAULT_PANEL_TITLE_FG;
        const titleBg = resolved.bg;

        for (let x = 0; x < width; x++) {
            const textIndex = x - this.titlePaddingLeft;
            const char = textIndex >= 0 && textIndex < this.title.length ? this.title[textIndex] : " ";
            context.setCell(x, 0, { char, fg: titleFg, bg: titleBg });
        }

        const childOffset = new Offset(this.child.localPosition.dx, this.child.localPosition.dy);
        const childClip = new Rect(this.child.globalPosition, this.child.layoutSize);
        this.child.render(context.withOffset(childOffset).withClip(childClip));
    }
}
