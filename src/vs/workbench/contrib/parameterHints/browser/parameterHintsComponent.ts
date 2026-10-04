import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import { CaretAnchoredOverlay } from "../../../browser/parts/editor/caretAnchoredOverlay.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

import { type IParameterHint, ParameterHintsElement } from "./parameterHintsElement.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ParameterHintsComponentDIToken = token<ParameterHintsComponent>("ParameterHintsComponent");

/**
 * Компонент попапа подсказки параметров: владеет {@link ParameterHintsElement}
 * и его overlay-сессией у каретки редактора. Логика (запрос источника, авто-
 * триггер при наборе, листание перегрузок) живёт в
 * {@link import("./parameterHintsService.ts").ParameterHintsService} —
 * компонент только показывает и двигает попап.
 *
 * Overlay-хост — корневая view окна из {@link LayoutService.mainContainer}:
 * сессия создаётся в конструкторе, как у suggest и hover.
 */
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

    /** Открыт ли попап (для `parameterHintsVisible` и делегаторов команд). */
    public isOpen(): boolean {
        return this.overlay.isOpen();
    }

    /** Наполняет попап; `null` — показывать нечего. */
    public setHint(hint: IParameterHint | null): void {
        this.view.setHint(hint);
    }

    /**
     * Позиционирует попап НАД строкой каретки и открывает сессию. Фокус не
     * забирает — редактор остаётся активным (VS Code-like).
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
        this.overlay.openAt(anchor, "aboveElseBelow");
    }

    /** Закрывает сессию; no-op, если уже закрыта (это гарантирует сам слой). */
    public close(): void {
        this.overlay.close();
    }
}
