import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import { CaretAnchoredOverlay } from "../../../browser/parts/editor/caretAnchoredOverlay.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

import { type IParameterHint, ParameterHintsElement } from "./parameterHintsElement.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
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
     * НАД строкой каретки: автодополнение предпочитает низ, без разведения они легли бы друг на друга.
     * `preferBelow: false` лишь снимает сдвиг вниз, поднимает попап `offsetY`; сверху места нет — низ.
     * Анкорить на КАЖДОМ показе: без пере-анкора новый контент остался бы «в дереве, но не на кадре».
     */
    public openAt(anchor: OverlayAnchorPosition): void {
        this.overlay.openAt(anchor, "aboveElseBelow");
    }

    public close(): void {
        this.overlay.close();
    }
}
