import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

export class TitledPanelElement extends TUIElement {
    private title: string;
    private child: TUIElement;
    private titlePaddingLeft: number;

    public constructor(title: string, child: TUIElement, options?: { titlePaddingLeft?: number }) {
        super();
        this.title = title;
        this.child = child;
        this.appendChild(this.child);
        this.titlePaddingLeft = options?.titlePaddingLeft ?? 1;
    }

    public getTitle(): string {
        return this.title;
    }

    public setTitle(value: string): void {
        this.title = value;
        this.markDirty();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        const childHeight = Math.max(0, containerSize.height - 1);

        this.layoutChild(this.child, 0, 1, BoxConstraints.tight(new Size(containerSize.width, childHeight)));

        return containerSize;
    }

    public override render(context: RenderContext): void {
        this.paintOwnBackground(context);
        const width = this.layoutSize.width;
        const resolved = this.resolvedStyle;
        const titleFg = this.styleVar("titledPanel.titleForeground");
        const titleBg = resolved.bg;

        for (let x = 0; x < width; x++) {
            const textIndex = x - this.titlePaddingLeft;
            const char = textIndex >= 0 && textIndex < this.title.length ? this.title[textIndex] : " ";
            context.setCell(x, 0, { char, fg: titleFg, bg: titleBg });
        }

        this.renderChildren(context);
    }
}
