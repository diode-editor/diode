import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlayAnchorPosition, OverlayLayer, OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";

/**
 * Upstream `ContentWidgetPositionPreference`, сведённый к двум случаям.
 * `aboveElseBelow` — parameter hints: так они не ложатся на попап автодополнения.
 */
export type CaretOverlayPlacement = "below" | "aboveElseBelow";

/**
 * Аналог upstream `IContentWidget`. Попап фокус не забирает — набор идёт в редактор;
 * команды попапа не focus-scoped, поэтому `capturesKeyboard: false` — иначе
 * диспатчер заглушил бы их.
 */
export class CaretAnchoredOverlay extends Disposable {
    private readonly session: OverlaySessionHandle;

    public constructor(
        host: { readonly overlayLayer: OverlayLayer },
        private readonly element: TUIElement,
    ) {
        super();
        this.session = host.overlayLayer.createSession(element, new Point(0, 0), {
            visible: false,
            // Stryker disable next-line BooleanLiteral: попап фокус не забирает, поэтому возвращать его слою некому — флаг стоит ради контракта сессии
            restoreFocus: true,
            capturesKeyboard: false,
            // Stryker disable next-line StringLiteral: клик мимо попапа и так закрывает его раньше — переносом каретки или сменой фокуса; политика стоит ради обратного контракта (клик ПО попапу его не закрывает)
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
     * Анкорить на КАЖДОМ показе, даже открытом: слой запоминает геометрию при анкоре,
     * и более широкий контент без пере-анкора остался бы «в дереве, но не на кадре».
     */
    public openAt(anchor: OverlayAnchorPosition, placement: CaretOverlayPlacement = "below"): void {
        this.setAnchor(anchor, placement);
        this.session.open();
    }

    /**
     * `aboveElseBelow`: `preferBelow: false` лишь снимает сдвиг вниз, и попап накрыл бы
     * каретку — поднимает его `offsetY` на свою высоту. Сверху места нет — падаем на низ,
     * иначе слой прижал бы попап к нулевой строке поверх каретки.
     */
    public setAnchor(anchor: OverlayAnchorPosition, placement: CaretOverlayPlacement = "below"): void {
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

    /** No-op, если уже закрыта (это гарантирует сам слой). */
    public close(): void {
        this.session.close();
    }
}
