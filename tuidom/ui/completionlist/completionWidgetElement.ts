import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

import { CompletionDetailsElement } from "./completionDetailsElement.ts";
import { CompletionListElement } from "./completionListElement.ts";

/** С какой стороны от списка стоит панель описания. */
export type CompletionDetailsSide = "right" | "left";

/**
 * Виджет автодополнения целиком: список пунктов и (опционально) панель описания
 * рядом. Именно он живёт в overlay-сессии — оверлей клампит и переворачивает
 * ОДИН элемент, поэтому список с панелью обязаны быть одним элементом, иначе у
 * края экрана они разъезжались бы поодиночке.
 *
 * Панель по умолчанию скрыта (как в VS Code) и включается тумблером
 * `toggleSuggestionDetails`; сторону выбирает владелец
 * ({@link import("../../../src/vs/workbench/contrib/suggest/browser/suggestComponent.ts").SuggestComponent})
 * по свободному месту справа от каретки.
 */
export class CompletionWidgetElement extends TUIElement {
    public readonly list: CompletionListElement;
    public readonly details: CompletionDetailsElement;

    private detailsVisibleValue = false;
    private detailsSideValue: CompletionDetailsSide = "right";

    public constructor() {
        super();
        // Как и список: фокус остаётся у редактора (см. CompletionListElement).
        this.focusable = false;
        this.list = new CompletionListElement();
        this.details = new CompletionDetailsElement();
        this.appendChild(this.list);
        this.appendChild(this.details);
    }

    /** Включён ли показ панели описания (состояние тумблера). */
    public get detailsVisible(): boolean {
        return this.detailsVisibleValue;
    }

    public set detailsVisible(value: boolean) {
        if (this.detailsVisibleValue === value) return;
        this.detailsVisibleValue = value;
        this.markDirty();
    }

    public get detailsSide(): CompletionDetailsSide {
        return this.detailsSideValue;
    }

    public set detailsSide(value: CompletionDetailsSide) {
        if (this.detailsSideValue === value) return;
        this.detailsSideValue = value;
        this.markDirty();
    }

    /** Панель реально показывается: тумблер включён И описание непустое. */
    public get showsDetails(): boolean {
        return this.detailsVisibleValue && !this.details.isEmpty;
    }

    // ─── Sizing ──────────────────────────────────────────────────────────────

    private get listWidth(): number {
        return this.list.getMaxIntrinsicWidth(0);
    }

    private get listHeight(): number {
        return this.list.getMaxIntrinsicHeight(0);
    }

    private get detailsWidth(): number {
        if (!this.showsDetails) return 0;
        // Панель не выше списка: попап у каретки и так близко к краю экрана.
        this.details.maxHeight = this.listHeight;
        return this.details.getMaxIntrinsicWidth(0);
    }

    private get widgetWidth(): number {
        return this.listWidth + this.detailsWidth;
    }

    private get widgetHeight(): number {
        if (!this.showsDetails) return this.listHeight;
        this.details.maxHeight = this.listHeight;
        return Math.max(this.listHeight, this.details.getMaxIntrinsicHeight(0));
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return this.widgetWidth;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.widgetWidth;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return this.widgetHeight;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return this.widgetHeight;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = constraints.constrain(new Size(this.widgetWidth, this.widgetHeight));
        super.performLayout(BoxConstraints.tight(size));

        const listWidth = Math.min(this.listWidth, size.width);
        const listHeight = Math.min(this.listHeight, size.height);
        const detailsWidth = Math.max(0, Math.min(this.detailsWidth, size.width - listWidth));
        const detailsHeight = detailsWidth === 0 ? 0 : Math.min(this.details.getMaxIntrinsicHeight(0), size.height);

        const detailsFirst = this.detailsSideValue === "left" && detailsWidth > 0;
        const listX = detailsFirst ? detailsWidth : 0;
        const detailsX = detailsFirst ? 0 : listWidth;

        this.layoutChild(this.list, listX, 0, BoxConstraints.tight(new Size(listWidth, listHeight)));
        this.layoutChild(this.details, detailsX, 0, BoxConstraints.tight(new Size(detailsWidth, detailsHeight)));
        return size;
    }
}
