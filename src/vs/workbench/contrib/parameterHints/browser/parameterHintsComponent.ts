import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlayAnchorPosition, OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";

import { ParameterHintsElement, type IParameterHint } from "./parameterHintsElement.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ParameterHintsComponentDIToken = token<ParameterHintsComponent>("ParameterHintsComponent");

/**
 * Компонент попапа подсказки параметров: владеет {@link ParameterHintsElement}
 * и его overlay-сессией у каретки редактора. Логика (запрос источника, авто-
 * триггер при наборе, листание перегрузок) живёт в
 * {@link import("./parameterHintsService.ts").ParameterHintsService} —
 * компонент только показывает и двигает попап.
 *
 * Overlay-хост (корневая BodyElement-view приложения) приходит через late-init
 * шов {@link attachHost} — его зовёт владелец корневой view (WorkbenchComponent)
 * после её постройки, как у suggest и hover.
 */
export class ParameterHintsComponent extends Component {
    public static dependencies = [] as const;

    public readonly view: ParameterHintsElement;

    private session: OverlaySessionHandle | null = null;

    public constructor() {
        super();
        this.view = new ParameterHintsElement();
        this.view.id = "parameterHintsWidget";
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
            // Редактор сохраняет фокус и продолжает принимать набор; наши команды
            // (`when: parameterHintsVisible`) НЕ focus-scoped, поэтому
            // capturesKeyboard обязан быть false — иначе диспатчер заглушил бы их
            // (та же причина, что у suggest и hover).
            capturesKeyboard: false,
            // Stryker disable next-line StringLiteral: клик мимо попапа и так закрывает его раньше — переносом каретки или сменой фокуса; политика стоит ради обратного контракта (клик ПО попапу его не закрывает)
            pointerPolicy: "close-on-outside",
        });
    }

    /** Открыт ли попап (для `parameterHintsVisible` и делегаторов команд). */
    public isOpen(): boolean {
        return this.session?.isOpen() === true;
    }

    /** Наполняет попап; `null` — показывать нечего. */
    public setHint(hint: IParameterHint | null): void {
        this.view.setHint(hint);
    }

    /**
     * Позиционирует попап НАД строкой каретки и открывает сессию. Фокус не
     * забирает — редактор остаётся активным (VS Code-like). Без прикреплённого
     * хоста — no-op.
     *
     * Верх — не косметика: попап автодополнения предпочитает низ, и без
     * разведения по разные стороны каретки они легли бы друг на друга (в VS Code
     * подсказка тоже висит над строкой вызова). Одного `preferBelow: false`
     * мало — он лишь снимает сдвиг на строку вниз, и попап накрыл бы саму
     * каретку; поднимает его `offsetY` на собственную высоту. Если сверху места
     * нет (каретка в первых строках), падаем на низ — иначе слой прижал бы попап
     * к нулевой строке и он всё равно закрыл бы каретку.
     *
     * Анкорить обязательно на КАЖДОМ показе, даже если попап уже открыт: слой
     * запоминает геометрию на момент анкоринга, и новый (более широкий) контент
     * без пере-анкора остался бы «в дереве, но не на кадре» — грабля
     * suggest-панели, см. `SuggestComponent.refreshDetailsLayout`.
     */
    public openAt(anchor: OverlayAnchorPosition): void {
        const height = this.view.getMaxIntrinsicHeight(this.view.getMaxIntrinsicWidth(0));
        const fitsAbove = anchor.screenY >= height;
        this.session?.setAnchor(
            fitsAbove ? { ...anchor, preferBelow: false, offsetY: -height } : { ...anchor, preferBelow: true },
        );
        this.session?.open();
    }

    /** Закрывает сессию; no-op, если уже закрыта. */
    public close(): void {
        if (this.session?.isOpen() === true) this.session.close();
    }
}
