import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlayAnchorPosition, OverlayLayer, OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";

/**
 * Где встаёт попап относительно каретки — аналог upstream
 * `ContentWidgetPositionPreference`, сведённый к двум нужным нам случаям:
 * - `"below"` — под строкой каретки (suggest, hover);
 * - `"aboveElseBelow"` — над строкой, а если сверху не хватает места, под ней
 *   (parameter hints: так она не ложится на попап автодополнения, как в VS Code).
 */
export type CaretOverlayPlacement = "below" | "aboveElseBelow";

/**
 * Попап у каретки редактора: overlay-сессия с опциями, общими для всех попапов
 * над редактором (suggest, hover, parameter hints), — аналог upstream
 * `IContentWidget`. Компоненты попапов СОДЕРЖАТ его, а не наследуют: у каждого
 * свой элемент и своя раскладка (сторона панели описания у suggest).
 *
 * Опции сессии: попап фокус не забирает — редактор остаётся активным и
 * обрабатывает набор и движение каретки; команды попапа (`when:
 * suggestWidgetVisible` и т.п.) не focus-scoped, поэтому `capturesKeyboard:
 * false` — иначе диспатчер заглушил бы их; клик мимо попапа его закрывает, клик
 * по нему — нет.
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

    /** Открыт ли попап. */
    public isOpen(): boolean {
        return this.session.isOpen();
    }

    /**
     * Позиционирует попап у каретки и открывает сессию.
     *
     * Анкорить обязательно на КАЖДОМ показе, даже если попап уже открыт: слой
     * запоминает геометрию на момент анкоринга, и новый (более широкий) контент
     * без пере-анкора остался бы «в дереве, но не на кадре».
     */
    public openAt(anchor: OverlayAnchorPosition, placement: CaretOverlayPlacement = "below"): void {
        this.setAnchor(anchor, placement);
        this.session.open();
    }

    /**
     * Пере-анкорит попап, не открывая его: вслед за кареткой или под новую
     * ширину содержимого.
     *
     * `"aboveElseBelow"`: одного `preferBelow: false` мало — он лишь снимает
     * сдвиг на строку вниз, и попап накрыл бы саму каретку; поднимает его
     * `offsetY` на собственную высоту. Если сверху места нет (каретка в первых
     * строках), падаем на низ — иначе слой прижал бы попап к нулевой строке и он
     * всё равно закрыл бы каретку.
     */
    public setAnchor(anchor: OverlayAnchorPosition, placement: CaretOverlayPlacement = "below"): void {
        if (placement === "below") {
            this.session.setAnchor(anchor);
            return;
        }
        const height = this.element.getMaxIntrinsicHeight(this.element.getMaxIntrinsicWidth(0));
        const fitsAbove = anchor.screenY >= height;
        this.session.setAnchor(
            fitsAbove ? { ...anchor, preferBelow: false, offsetY: -height } : { ...anchor, preferBelow: true },
        );
    }

    /** Закрывает сессию; no-op, если уже закрыта (это гарантирует сам слой). */
    public close(): void {
        this.session.close();
    }
}
