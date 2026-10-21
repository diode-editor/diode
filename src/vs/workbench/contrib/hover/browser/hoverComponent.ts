import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import { CaretAnchoredOverlay } from "../../../browser/parts/editor/caretAnchoredOverlay.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

import { HoverElement } from "./hoverElement.ts";

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is only a debug label
export const HoverComponentDIToken = token<HoverComponent>("HoverComponent");

export class HoverComponent extends Component {
    public static dependencies = [LayoutServiceDIToken] as const;

    public readonly view: HoverElement;

    private readonly overlay: CaretAnchoredOverlay;

    public constructor(layoutService: LayoutService) {
        super();
        this.view = new HoverElement();
        this.view.id = "hoverWidget";
        this.overlay = this.register(new CaretAnchoredOverlay(layoutService.mainContainer, this.view));
    }

    public isOpen(): boolean {
        return this.overlay.isOpen();
    }

    public setBlocks(blocks: readonly string[]): void {
        this.view.setBlocks(blocks);
    }

    /**
     * Re-anchor on every show, even with the popup open: the layer remembers the geometry at anchoring
     * time, and wider content without a re-anchor wouldn't fit the frame (a pitfall hit by the suggest panel).
     */
    public openAt(anchor: OverlayAnchorPosition): void {
        this.overlay.openAt(anchor);
    }

    public close(): void {
        this.overlay.close();
    }
}
