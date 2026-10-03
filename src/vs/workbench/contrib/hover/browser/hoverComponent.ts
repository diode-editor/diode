import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlayAnchorPosition, OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

import { HoverElement } from "./hoverElement.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const HoverComponentDIToken = token<HoverComponent>("HoverComponent");

/**
 * Компонент hover-попапа: владеет {@link HoverElement} и его overlay-сессией у
 * каретки редактора. Логика (запрос источника, стрип markdown, закрытие по
 * фокусу/каретке) живёт в {@link import("./hoverService.ts").HoverService} —
 * компонент только показывает/двигает попап.
 *
 * Overlay-хост — корневая view окна из {@link LayoutService.mainContainer}:
 * сессия создаётся в конструкторе, как у SuggestComponent.
 */
export class HoverComponent extends Component {
    public static dependencies = [LayoutServiceDIToken] as const;

    public readonly view: HoverElement;

    private readonly session: OverlaySessionHandle;

    public constructor(layoutService: LayoutService) {
        super();
        this.view = new HoverElement();
        this.view.id = "hoverWidget";
        this.session = layoutService.mainContainer.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            // Stryker disable next-line BooleanLiteral: попап фокус не забирает (focusable=false у элемента), поэтому возвращать его слою некому — флаг стоит ради контракта сессии
            restoreFocus: true,
            // Редактор сохраняет фокус и обрабатывает набор/движение каретки; наши
            // команды (`when: editorHoverVisible`) НЕ focus-scoped, поэтому
            // capturesKeyboard должен быть false — иначе диспатчер заглушил бы их
            // (та же причина, что у suggest).
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

    /** Открыт ли попап (для `editorHoverVisible` и делегаторов команд). */
    public isOpen(): boolean {
        return this.session.isOpen();
    }

    /** Наполняет попап блоками (по одному на провайдера). */
    public setBlocks(blocks: readonly string[]): void {
        this.view.setBlocks(blocks);
    }

    /**
     * Позиционирует попап у каретки и открывает сессию. Фокус НЕ забирает —
     * редактор остаётся активным (VS Code-like).
     *
     * Анкорить обязательно на КАЖДОМ показе, даже если попап уже открыт: слой
     * запоминает геометрию на момент анкоринга, и новый (более широкий) контент
     * без пере-анкора остался бы «в дереве, но не на кадре» — грабля
     * suggest-панели, см. `SuggestComponent.refreshDetailsLayout`.
     */
    public openAt(anchor: OverlayAnchorPosition): void {
        this.session.setAnchor(anchor);
        this.session.open();
    }

    /** Закрывает сессию; no-op, если уже закрыта (это гарантирует сам слой). */
    public close(): void {
        this.session.close();
    }
}
