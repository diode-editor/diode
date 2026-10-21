import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import { CaretAnchoredOverlay } from "../../../browser/parts/editor/caretAnchoredOverlay.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

import { type IParameterHint, ParameterHintsElement } from "./parameterHintsElement.ts";

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference — the string inside is only a debug label
export const ParameterHintsComponentDIToken = token<ParameterHintsComponent>("ParameterHintsComponent");

export class ParameterHintsComponent extends Component {
    public static dependencies = [LayoutServiceDIToken] as const;

    public readonly view: ParameterHintsElement;

    private readonly overlay: CaretAnchoredOverlay;

    public constructor(layoutService: LayoutService) {
        super();
        this.view = new ParameterHintsElement();
        this.view.id = "parameterHintsWidget";
        this.overlay = this.register(new CaretAnchoredOverlay(layoutService.mainContainer, this.view));
    }

    public isOpen(): boolean {
        return this.overlay.isOpen();
    }

    public setHint(hint: IParameterHint | null): void {
        this.view.setHint(hint);
    }

    /**
     * ABOVE the cursor line: suggest prefers below, and without separating them they would overlap.
     * `preferBelow: false` only removes the downward shift; `offsetY` lifts the popup; no room above — below.
     * Anchor on EVERY show: without re-anchoring, new content would stay "in the tree but not in the frame".
     */
    public openAt(anchor: OverlayAnchorPosition): void {
        this.overlay.openAt(anchor, "aboveElseBelow");
    }

    public close(): void {
        this.overlay.close();
    }
}
