import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import type {
    CompletionDetailsContent,
    CompletionDetailsElement,
} from "@tuidom/elements/completionlist/completionDetailsElement";
import type { CompletionListElement } from "@tuidom/elements/completionlist/completionListElement";
import { CompletionWidgetElement } from "@tuidom/elements/completionlist/completionWidgetElement";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import { CaretAnchoredOverlay } from "../../../browser/parts/editor/caretAnchoredOverlay.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

export const SuggestComponentDIToken = token<SuggestComponent>("SuggestComponent");

/** Не ThemedComponent: токены `editorSuggestWidget.*` резолвятся из палитры темы на корне. */
export class SuggestComponent extends Component {
    public static dependencies = [LayoutServiceDIToken] as const;

    public readonly widget: CompletionWidgetElement;

    private readonly overlay: CaretAnchoredOverlay;
    /** По её ширине выбирается сторона панели описания. */
    private readonly hostView: BodyElement;
    private lastAnchor: OverlayAnchorPosition | null = null;

    public constructor(layoutService: LayoutService) {
        super();
        this.widget = new CompletionWidgetElement();
        this.widget.id = "suggestWidget";
        this.view.id = "suggestList";
        this.widget.details.id = "suggestDetails";
        this.hostView = layoutService.mainContainer;
        this.overlay = this.register(new CaretAnchoredOverlay(this.hostView, this.widget));
    }

    public get view(): CompletionListElement {
        return this.widget.list;
    }

    public get details(): CompletionDetailsElement {
        return this.widget.details;
    }

    public setDetailsContent(content: CompletionDetailsContent | null): void {
        this.widget.details.setContent(content);
        this.refreshDetailsLayout();
    }

    public get detailsVisible(): boolean {
        return this.widget.detailsVisible;
    }

    public set detailsVisible(value: boolean) {
        this.widget.detailsVisible = value;
    }

    public isOpen(): boolean {
        return this.overlay.isOpen();
    }

    /** Фокус НЕ забирает — редактор остаётся активным, как в VS Code. */
    public openAt(anchor: OverlayAnchorPosition): void {
        this.lastAnchor = anchor;
        this.chooseDetailsSide(anchor);
        this.overlay.openAt(anchor);
    }

    /**
     * Отдельный шаг: описание приезжает асинхронно (resolve) после показа списка, и без пере-анкора
     * слой оставлял позицию и damage прежней геометрии — панели на экране не было.
     */
    public refreshDetailsLayout(): void {
        const anchor = this.lastAnchor;
        if (anchor === null) return;
        this.chooseDetailsSide(anchor);
        this.overlay.setAnchor(anchor);
    }

    /**
     * Справа, а если не помещается — слева (как в VS Code): иначе оверлей сдвинул бы виджет целиком,
     * и список уехал бы от каретки.
     */
    private chooseDetailsSide(anchor: OverlayAnchorPosition): void {
        const screenWidth = this.hostView.layoutSize.width;
        if (screenWidth === 0) return;
        const needed = this.widget.getMaxIntrinsicWidth(0);
        this.widget.detailsSide = anchor.screenX + needed <= screenWidth ? "right" : "left";
    }

    public setAnchor(anchor: OverlayAnchorPosition): void {
        this.lastAnchor = anchor;
        this.overlay.setAnchor(anchor);
    }

    public close(): void {
        this.overlay.close();
    }
}
