import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

/**
 * Заливает весь свой прямоугольник пробелами с цветами из resolvedStyle —
 * «красящий фон» кусок для flex-раскладок: разделители и паддинги статус-бара,
 * хвост строки табов, пустая область группы редакторов. Интринсики не
 * переопределены: базовые нули — ровно то, что нужно филлеру (сам по себе
 * места не просит, размер всегда назначает контейнер).
 */
export class FillerElement extends TUIElement {
    public override render(context: RenderContext): void {
        const { width, height } = this.layoutSize;
        const resolved = this.resolvedStyle;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                context.setCell(x, y, { char: " ", fg: resolved.fg, bg: resolved.bg });
            }
        }
    }
}
