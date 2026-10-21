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

/** Not a ThemedComponent: the `editorSuggestWidget.*` tokens resolve from the theme palette on the root. */
export class SuggestComponent extends Component {
    public static dependencies = [LayoutServiceDIToken] as const;

    public readonly widget: CompletionWidgetElement;

    private readonly overlay: CaretAnchoredOverlay;
    /** Its width decides the details panel side. */
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

    /** Does NOT take focus — the editor stays active, like VS Code. */
    public openAt(anchor: OverlayAnchorPosition): void {
        this.lastAnchor = anchor;
        this.chooseDetailsSide(anchor);
        this.overlay.openAt(anchor);
    }

    /**
     * A separate step: the description arrives asynchronously (resolve) after the list is shown, and without
     * a re-anchor the layer kept the position and damage of the old geometry — the panel never showed up.
     */
    public refreshDetailsLayout(): void {
        const anchor = this.lastAnchor;
        if (anchor === null) return;
        this.chooseDetailsSide(anchor);
        this.overlay.setAnchor(anchor);
    }

    /**
     * On the right, or on the left if it doesn't fit (like VS Code): otherwise the overlay would shift the whole
     * widget, and the list would drift away from the cursor.
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
