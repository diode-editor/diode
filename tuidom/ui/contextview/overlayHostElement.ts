import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import { OverlayLayer } from "./overlayLayer.ts";

/**
 * Контейнер «контент + локальный overlay-слой поверх»: оба ребёнка кладутся
 * tight на весь размер хоста, слой — последним (z-порядок = порядок детей,
 * значит хит-тест сначала видит оверлей).
 *
 * Слой хоста — только для адресно докнутых виджетов (find и т.п.), которые
 * приходят к нему напрямую через {@link overlayLayer}. getOverlayLayer
 * сознательно НЕ переопределён: попапы/контекстные меню из содержимого хоста
 * должны жить в глобальном слое BodyElement (позиции слоя — в локальных
 * координатах хоста, а слой вдобавок клипует к его границам).
 */
export class OverlayHostElement extends TUIElement {
    public readonly overlayLayer: OverlayLayer;
    private content: TUIElement | null = null;

    public constructor() {
        super();
        this.overlayLayer = new OverlayLayer();
        this.syncChildren();
    }

    public getContent(): TUIElement | null {
        return this.content;
    }

    public setContent(element: TUIElement | null): void {
        this.content = element;
        this.syncChildren();
        this.markDirty();
    }

    private syncChildren(): void {
        const children: TUIElement[] = [];
        if (this.content) children.push(this.content);
        children.push(this.overlayLayer);
        this.setChildren(children);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);

        if (this.content) {
            this.layoutChild(this.content, 0, 0, BoxConstraints.tight(containerSize));
        }

        // Слой покрывает весь хост; позиции item'ов — относительно его top-left.
        this.layoutChild(this.overlayLayer, 0, 0, BoxConstraints.tight(containerSize));

        return containerSize;
    }
}
