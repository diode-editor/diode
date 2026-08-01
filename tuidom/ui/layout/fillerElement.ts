import { INHERITED_BG, INHERITED_FG } from "../../dom/styles/tuiStyle.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

/**
 * «Красящий фон» кусок для flex-раскладок: разделители и паддинги статус-бара,
 * хвост строки табов, пустая область группы редакторов. Собственного render
 * нет: конструктор объявляет фон сентинелами INHERITED_* — «владею фоном,
 * крашу его унаследованными цветами» — и заливку делает база
 * (paintOwnBackground). Интринсики не переопределены: базовые нули — ровно то,
 * что нужно филлеру (сам по себе места не просит, размер назначает контейнер).
 */
export class FillerElement extends TUIElement {
    public constructor() {
        super();
        this.style = { fg: INHERITED_FG, bg: INHERITED_BG };
    }
}
