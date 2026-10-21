import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import { CaretAnchoredOverlay } from "../../../browser/parts/editor/caretAnchoredOverlay.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

import { HoverElement } from "./hoverElement.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
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
     * Анкорить на каждом показе, даже при открытом попапе: слой запоминает геометрию на момент
     * анкоринга, и более широкий контент без пере-анкора не попал бы в кадр (грабля suggest-панели).
     */
    public openAt(anchor: OverlayAnchorPosition): void {
        this.overlay.openAt(anchor);
    }

    public close(): void {
        this.overlay.close();
    }
}
