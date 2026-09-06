import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlayAnchorPosition, OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";

import { HoverElement } from "./hoverElement.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const HoverComponentDIToken = token<HoverComponent>("HoverComponent");

/**
 * Компонент hover-попапа: владеет {@link HoverElement} и его overlay-сессией у
 * каретки редактора. Логика (запрос источника, стрип markdown, закрытие по
 * фокусу/каретке) живёт в {@link import("./hoverService.ts").HoverService} —
 * компонент только показывает/двигает попап.
 *
 * Overlay-хост (корневая BodyElement-view приложения) приходит через late-init
 * шов {@link attachHost} — его зовёт владелец корневой view (WorkbenchComponent)
 * после её постройки, как у SuggestComponent.
 */
export class HoverComponent extends Component {
    public static dependencies = [] as const;

    public readonly view: HoverElement;

    private session: OverlaySessionHandle | null = null;

    public constructor() {
        super();
        this.view = new HoverElement();
        this.view.id = "hoverWidget";
        this.register({
            dispose: () => {
                // Stryker disable next-line OptionalChaining: без attachHost сессии нет — обращение к её dispose кинуло бы на выключении приложения
                this.session?.dispose();
                this.session = null;
            },
        });
    }

    /** Вызывается владельцем корневой view до первого показа попапа. */
    public attachHost(host: BodyElement): void {
        this.session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            // Stryker disable next-line BooleanLiteral: попап фокус не забирает (focusable=false у элемента), поэтому возвращать его слою некому — флаг стоит ради контракта сессии
            restoreFocus: true,
            // Редактор сохраняет фокус и обрабатывает набор/движение каретки; наши
            // команды (`when: editorHoverVisible`) НЕ focus-scoped, поэтому
            // capturesKeyboard должен быть false — иначе диспатчер заглушил бы их
            // (та же причина, что у suggest).
            capturesKeyboard: false,
            pointerPolicy: "close-on-outside",
        });
    }

    /** Открыт ли попап (для `editorHoverVisible` и делегаторов команд). */
    public isOpen(): boolean {
        return this.session?.isOpen() === true;
    }

    /** Наполняет попап блоками (по одному на провайдера). */
    public setBlocks(blocks: readonly string[]): void {
        this.view.setBlocks(blocks);
    }

    /**
     * Позиционирует попап у каретки и открывает сессию. Фокус НЕ забирает —
     * редактор остаётся активным (VS Code-like). Без прикреплённого хоста —
     * no-op.
     *
     * Анкорить обязательно на КАЖДОМ показе, даже если попап уже открыт: слой
     * запоминает геометрию на момент анкоринга, и новый (более широкий) контент
     * без пере-анкора остался бы «в дереве, но не на кадре» — грабля
     * suggest-панели, см. `SuggestComponent.refreshDetailsLayout`.
     */
    public openAt(anchor: OverlayAnchorPosition): void {
        this.session?.setAnchor(anchor);
        this.session?.open();
    }

    /** Закрывает сессию; no-op, если уже закрыта. */
    public close(): void {
        if (this.session?.isOpen() === true) this.session.close();
    }
}
