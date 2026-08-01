import { Point } from "../../../../../../tuidom/common/geometryPromitives.ts";
import type { BodyElement } from "../../../../../../tuidom/ui/body/bodyElement.ts";
import { CompletionListElement } from "../../../../../../tuidom/ui/completionlist/completionListElement.ts";
import type {
    OverlayAnchorPosition,
    OverlaySessionHandle,
} from "../../../../../../tuidom/ui/contextview/overlayLayer.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";

export const SuggestComponentDIToken = token<SuggestComponent>("SuggestComponent");

/**
 * Компонент suggest-попапа: владеет {@link CompletionListElement} и его
 * overlay-сессией у каретки редактора. Вся логика автодополнения (источники,
 * триггеры, префикс/re-filter, accept) живёт в
 * {@link import("./completionService.ts").CompletionService} —
 * компонент только показывает/двигает попап и раздаёт вызовы контролу.
 *
 * Не {@link import("../../../browser/component.ts").ThemedComponent}: CompletionListElement
 * токены editorSuggestWidget.* резолвятся из палитры темы на корне (Н3).
 * дефолт контрола), маппинг на ключи темы — отдельная задача.
 *
 * Overlay-хост (корневая BodyElement-view приложения) приходит через late-init
 * шов {@link attachHost} — его зовёт владелец корневой view (сейчас
 * WorkbenchComponent) после её постройки, как у QuickInputComponent/DialogService.
 */
export class SuggestComponent extends Component {
    public static dependencies = [] as const;

    public readonly view: CompletionListElement;

    private session: OverlaySessionHandle | null = null;

    public constructor() {
        super();
        this.view = new CompletionListElement();
        this.view.id = "suggestWidget";
        this.register({
            dispose: () => {
                this.session?.dispose();
                this.session = null;
            },
        });
    }

    /** Вызывается владельцем корневой view до первого показа попапа. */
    public attachHost(host: BodyElement): void {
        this.session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            restoreFocus: true,
            // Редактор сохраняет фокус и обрабатывает набор/движение каретки; наши
            // команды (`when: suggestWidgetVisible`) НЕ focus-scoped, поэтому
            // capturesKeyboard должен быть false — иначе диспатчер заглушил бы их.
            capturesKeyboard: false,
            pointerPolicy: "close-on-outside",
        });
    }

    /** Открыт ли попап (для `suggestWidgetVisible` и делегаторов команд). */
    public isOpen(): boolean {
        return this.session?.isOpen() === true;
    }

    /**
     * Позиционирует попап у каретки и открывает сессию. Фокус НЕ забирает —
     * редактор остаётся активным (VS Code-like). Без прикреплённого хоста —
     * no-op (как раньше у контроллера без setHostView).
     */
    public openAt(anchor: OverlayAnchorPosition): void {
        this.session?.setAnchor(anchor);
        this.session?.open();
    }

    /** Двигает открытый попап вслед за кареткой (re-filter при наборе). */
    public setAnchor(anchor: OverlayAnchorPosition): void {
        this.session?.setAnchor(anchor);
    }

    /** Закрывает сессию; no-op, если уже закрыта. */
    public close(): void {
        if (this.session?.isOpen() === true) this.session.close();
    }
}
