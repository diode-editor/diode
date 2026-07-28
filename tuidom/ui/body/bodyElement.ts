import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { OverlayLayer } from "../contextview/overlayLayer.ts";
import { VFlexElement, vflexFill, vflexFixed } from "../layout/vFlexElement.ts";

export class BodyElement extends TUIElement {
    public title = "";
    public readonly overlayLayer: OverlayLayer;

    private readonly vflex = new VFlexElement();
    /**
     * Держит место контента, пока тот не задан: без fill-ряда между menuBar и
     * statusBar статус-бар прилипал бы к верху, а не к нижнему ряду. Ничего не
     * рисует (дефолтный render пустого элемента).
     */
    private readonly contentSpacer = new TUIElement();
    private menuBar: TUIElement | null = null;
    private content: TUIElement | null = null;
    private statusBar: TUIElement | null = null;

    public constructor() {
        super();
        // BodyElement is the root, so mark it as such
        this.setAsRoot();

        this.overlayLayer = new OverlayLayer();
        // Дети body неизменны; порядок — это z-порядок хит-теста:
        // overlay последний, т.е. поверх всего.
        this.setChildren([this.vflex, this.overlayLayer]);
    }

    public override getOverlayLayer(): OverlayLayer {
        return this.overlayLayer;
    }

    public setContent(element: TUIElement): void {
        this.content = element;
        this.syncSlots();
    }

    /** Слот занимает ровно 1 ряд — виджет, рисующий ниже ряда 0, будет обрезан. */
    public setMenuBar(menuBar: TUIElement | null): void {
        this.menuBar = menuBar;
        this.syncSlots();
    }

    /** Слот занимает ровно 1 ряд — виджет, рисующий ниже ряда 0, будет обрезан. */
    public setStatusBar(statusBar: TUIElement | null): void {
        this.statusBar = statusBar;
        this.syncSlots();
    }

    /**
     * Пересобирает ряды vflex в каноническом порядке слотов: menuBar (1 ряд),
     * content (остаток), statusBar (1 ряд).
     */
    private syncSlots(): void {
        const rows: TUIElement[] = [];
        if (this.menuBar) {
            this.menuBar.layoutStyle = { height: vflexFixed(1), width: "fill" };
            rows.push(this.menuBar);
        }
        const contentRow = this.content ?? this.contentSpacer;
        contentRow.layoutStyle = { height: vflexFill(), width: "fill" };
        rows.push(contentRow);
        if (this.statusBar) {
            this.statusBar.layoutStyle = { height: vflexFixed(1), width: "fill" };
            rows.push(this.statusBar);
        }
        this.vflex.replaceChildren(rows);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);

        this.layoutChild(this.vflex, 0, 0, BoxConstraints.tight(containerSize));
        this.layoutChild(this.overlayLayer, 0, 0, BoxConstraints.tight(containerSize));

        return containerSize;
    }

    public render(context: RenderContext) {
        // Title (legacy behaviour)
        for (let y = 0; y < this.title.length; y++) {
            context.setCell(y, 0, { char: this.title[y] });
        }

        this.renderChildren(context);
    }
}
