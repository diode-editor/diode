import { Point } from "../../../../../../tuidom/common/geometryPromitives.ts";
import type { BodyElement } from "../../../../../../tuidom/ui/body/bodyElement.ts";
import type {
    CompletionDetailsContent,
    CompletionDetailsElement,
} from "../../../../../../tuidom/ui/completionlist/completionDetailsElement.ts";
import type { CompletionListElement } from "../../../../../../tuidom/ui/completionlist/completionListElement.ts";
import { CompletionWidgetElement } from "../../../../../../tuidom/ui/completionlist/completionWidgetElement.ts";
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

    /** Виджет целиком: список + панель описания (она же — элемент оверлея). */
    public readonly widget: CompletionWidgetElement;

    private session: OverlaySessionHandle | null = null;
    /** Корневая view — по её ширине выбирается сторона панели описания. */
    private hostView: BodyElement | null = null;
    /** Последний якорь у каретки (для пересчёта стороны панели). */
    private lastAnchor: OverlayAnchorPosition | null = null;

    public constructor() {
        super();
        this.widget = new CompletionWidgetElement();
        this.widget.id = "suggestWidget";
        this.view.id = "suggestList";
        this.widget.details.id = "suggestDetails";
        this.register({
            dispose: () => {
                this.session?.dispose();
                this.session = null;
            },
        });
    }

    /** Список пунктов — сам виджет остаётся владельцем и оверлей-элементом. */
    public get view(): CompletionListElement {
        return this.widget.list;
    }

    /** Панель описания выбранного пункта (чтение — тесты и измерения). */
    public get details(): CompletionDetailsElement {
        return this.widget.details;
    }

    /**
     * Наполняет панель описанием и пере-раскладывает попап под её новую ширину
     * (см. {@link refreshDetailsLayout}).
     */
    public setDetailsContent(content: CompletionDetailsContent | null): void {
        this.widget.details.setContent(content);
        this.refreshDetailsLayout();
    }

    /** Показывать ли панель описания (тумблер `toggleSuggestionDetails`). */
    public get detailsVisible(): boolean {
        return this.widget.detailsVisible;
    }

    public set detailsVisible(value: boolean) {
        this.widget.detailsVisible = value;
    }

    /** Вызывается владельцем корневой view до первого показа попапа. */
    public attachHost(host: BodyElement): void {
        this.hostView = host;
        this.session = host.overlayLayer.createSession(this.widget, new Point(0, 0), {
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
        this.lastAnchor = anchor;
        this.chooseDetailsSide(anchor);
        this.session?.setAnchor(anchor);
        this.session?.open();
    }

    /**
     * Пере-раскладывает попап под текущее содержимое панели: выбирает сторону и
     * пере-анкорит overlay-сессию.
     *
     * Нужен отдельным шагом, потому что описание приезжает АСИНХРОННО (resolve)
     * уже после показа списка: на момент `openAt` виджет ещё шириной в один
     * список. Без пере-анкора слой оставляет позицию и damage от прежней
     * геометрии — панель есть в раскладке, но на экране её нет (проверено на
     * настоящем бинаре).
     */
    public refreshDetailsLayout(): void {
        const anchor = this.lastAnchor;
        if (anchor === null) return;
        this.chooseDetailsSide(anchor);
        this.session?.setAnchor(anchor);
    }

    /**
     * Панель описания — справа от списка, а если справа не помещается, слева
     * (как в VS Code). Без переворота оверлей сдвинул бы виджет целиком влево, и
     * список уехал бы от каретки.
     */
    private chooseDetailsSide(anchor: OverlayAnchorPosition): void {
        const screenWidth = this.hostView?.layoutSize.width ?? 0;
        if (screenWidth === 0) return;
        const needed = this.widget.getMaxIntrinsicWidth(0);
        this.widget.detailsSide = anchor.screenX + needed <= screenWidth ? "right" : "left";
    }

    /** Двигает открытый попап вслед за кареткой (re-filter при наборе). */
    public setAnchor(anchor: OverlayAnchorPosition): void {
        this.lastAnchor = anchor;
        this.session?.setAnchor(anchor);
    }

    /** Закрывает сессию; no-op, если уже закрыта. */
    public close(): void {
        if (this.session?.isOpen() === true) this.session.close();
    }
}
