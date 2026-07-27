import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { OverlayLayer } from "../contextview/overlayLayer.ts";

import { EditorTabStripElement } from "./editorTabStripElement.ts";

export class EditorGroupElement extends TUIElement {
    public readonly tabStrip: EditorTabStripElement;
    private content: TUIElement | null = null;
    private readonly overlayLayerValue: OverlayLayer;

    public constructor() {
        super();
        this.tabStrip = new EditorTabStripElement();
        this.overlayLayerValue = new OverlayLayer();
        this.syncChildren();
    }

    /**
     * Local overlay layer sitting on top of the editor content — hosts the find
     * widget (and any future editor-group overlay). Positions are relative to the
     * group; the layer clips its items to the group bounds.
     */
    /**
     * Слой группы — только для докнутых виджетов группы (find), которые приходят
     * к нему адресно через этот геттер. getOverlayLayer здесь сознательно НЕ
     * переопределён: попапы/контекстные меню из содержимого группы должны жить
     * в глобальном слое BodyElement (позиции слоя — в его локальных координатах,
     * а слой группы вдобавок клипует к её границам).
     */
    public get overlayLayer(): OverlayLayer {
        return this.overlayLayerValue;
    }

    public getContent(): TUIElement | null {
        return this.content;
    }

    public setContent(element: TUIElement | null): void {
        this.content = element;
        this.syncChildren();
        this.markDirty();
    }

    /**
     * Канонический порядок слотов. Overlay layer last → hit-tested first
     * (clicks on the find widget win over the editor underneath; clicks
     * elsewhere fall through to content).
     */
    private syncChildren(): void {
        const children: TUIElement[] = [this.tabStrip];
        if (this.content) children.push(this.content);
        children.push(this.overlayLayerValue);
        this.setChildren(children);
    }

    // ─── Layout ───

    public override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        const tabStripHeight = 1;

        // Tab strip: 1 row at top
        this.layoutChild(this.tabStrip, 0, 0, BoxConstraints.tight(new Size(containerSize.width, tabStripHeight)));

        // Content: remaining height
        if (this.content) {
            const contentHeight = Math.max(0, containerSize.height - tabStripHeight);
            this.layoutChild(this.content, 0, tabStripHeight, BoxConstraints.tight(new Size(containerSize.width, contentHeight)));
        }

        // Overlay layer covers the whole group (tab strip + content); item
        // positions are relative to the group's top-left.
        this.layoutChild(this.overlayLayerValue, 0, 0, BoxConstraints.tight(containerSize));

        return containerSize;
    }

    // ─── Render ───

    public override render(context: RenderContext): void {
        // Tab strip
        this.tabStrip.render(context.withOffset(this.tabStrip.localPosition));

        // Content
        if (this.content) {
            const contentOffset = new Offset(this.content.localPosition.dx, this.content.localPosition.dy);
            const contentClip = new Rect(this.content.globalPosition, this.content.layoutSize);
            this.content.render(context.withOffset(contentOffset).withClip(contentClip));
        } else {
            const resolved = this.resolvedStyle;
            const { width, height } = this.layoutSize;
            const tabStripHeight = 1;
            for (let y = tabStripHeight; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    context.setCell(x, y, { char: " ", fg: resolved.fg, bg: resolved.bg });
                }
            }
        }

        // Overlay layer (find widget, …) — rendered last, on top of the content.
        this.overlayLayerValue.render(context);
    }
}
