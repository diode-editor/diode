import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlayAnchorPosition, OverlayLayer, OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";

/**
 * Upstream `ContentWidgetPositionPreference`, reduced to two cases.
 * `aboveElseBelow` is for parameter hints, so they don't cover the completion popup.
 */
export type CaretOverlayPlacement = "below" | "aboveElseBelow";

export interface ICaretOverlayOptions {
    /**
     * The popup is focused by its owner (the debug hover): Escape and a click outside close it, and the focus goes back
     * where it was. Global keys still work, as upstream's hover is a plain DOM node: F10 steps from the debug hover.
     */
    readonly takesFocus?: boolean;
    readonly onClose?: () => void;
}

/**
 * Counterpart of upstream `IContentWidget`. By default the popup does not take focus, so typing goes to the
 * editor; its commands are not focus-scoped, hence `capturesKeyboard: false` — otherwise the dispatcher
 * would swallow them.
 */
export class CaretAnchoredOverlay extends Disposable {
    private readonly session: OverlaySessionHandle;
    /** The last anchoring: {@link relayout} applies it again. The session opens only after one. */
    private anchored!: { anchor: OverlayAnchorPosition; placement: CaretOverlayPlacement };

    public constructor(
        host: { readonly overlayLayer: OverlayLayer },
        private readonly element: TUIElement,
        options: ICaretOverlayOptions = {},
    ) {
        super();
        this.session = host.overlayLayer.createSession(element, new Point(0, 0), {
            visible: false,
            restoreFocus: true,
            capturesKeyboard: false,
            closeOnEscape: options.takesFocus === true,
            onClose: options.onClose,
            // Stryker disable next-line StringLiteral: a click outside the popup already closes it earlier, by moving the cursor or the focus; the policy is kept for the reverse contract (a click ON the popup does not close it)
            pointerPolicy: "close-on-outside",
        });
        this.register({
            dispose: () => {
                this.session.dispose();
            },
        });
    }

    public isOpen(): boolean {
        return this.session.isOpen();
    }

    /**
     * Re-anchors on EVERY show, even when already open: the layer captures geometry when anchoring,
     * so wider content without a re-anchor would end up "in the tree but not in the frame".
     */
    public openAt(anchor: OverlayAnchorPosition, placement: CaretOverlayPlacement = "below"): void {
        this.setAnchor(anchor, placement);
        this.session.open();
    }

    /**
     * `aboveElseBelow`: `preferBelow: false` only drops the downward shift, so the popup would cover
     * the cursor; `offsetY` lifts it by its own height. With no room above, falls back to below,
     * otherwise the layer would clamp the popup to row 0 on top of the cursor.
     */
    public setAnchor(anchor: OverlayAnchorPosition, placement: CaretOverlayPlacement = "below"): void {
        this.anchored = { anchor, placement };
        switch (placement) {
            case "below":
                this.session.setAnchor(anchor);
                return;
            case "aboveElseBelow": {
                const height = this.element.getMaxIntrinsicHeight(this.element.getMaxIntrinsicWidth(0));
                const fitsAbove = anchor.screenY >= height;
                this.session.setAnchor(
                    fitsAbove ? { ...anchor, preferBelow: false, offsetY: -height } : { ...anchor, preferBelow: true },
                );
                return;
            }
        }
    }

    /** The popup changed its size while open: anchored again where it was, so `aboveElseBelow` follows its height. */
    public relayout(): void {
        if (this.isOpen()) this.setAnchor(this.anchored.anchor, this.anchored.placement);
    }

    /** No-op when already closed (guaranteed by the layer itself). */
    public close(): void {
        this.session.close();
    }
}
