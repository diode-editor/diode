import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { MruCycleState } from "../../../services/editor/browser/editorGroupModel.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { Component } from "../../component.ts";

import { computeTabLabels } from "./tabLabels.ts";
import { TabSwitcherElement, type TabSwitcherItem } from "./tabSwitcherElement.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TabSwitcherComponentDIToken = token<TabSwitcherComponent>("TabSwitcherComponent");

/**
 * Видимый список серии Ctrl+Tab (VS Code показывает на этом месте editor
 * picker): пока Ctrl удержан, поверх редактора висит MRU-список вкладок текущей
 * группы с подсветкой позиции цикла; отпускание Ctrl (или любой другой конец
 * серии) гасит список. Компонент чисто реактивный: командам и клавиатуре он
 * неизвестен — жизнью оверлея управляют события модели
 * ({@link EditorService.onDidChangeMruCycle}), которые файрит каждый шаг
 * {@link import("../../../services/editor/browser/editorGroupModel.ts").EditorGroup.cycleMru}
 * и любой конец серии.
 *
 * Overlay-сессия — passthrough и без фокуса: список только показывает состояние
 * серии, ввод продолжает идти в редактор (и глобальные бинды Ctrl+Tab работают
 * поверх видимого оверлея). Overlay-хост приходит через late-init шов
 * {@link attachHost}, как у QuickInput/Suggest/Hover.
 */
export class TabSwitcherComponent extends Component {
    public static dependencies = [EditorServiceDIToken] as const;

    public readonly view: TabSwitcherElement;

    private host: BodyElement | null = null;
    private session: OverlaySessionHandle | null = null;

    public constructor(private readonly editorService: EditorService) {
        super();
        this.view = new TabSwitcherElement();
        this.view.id = "tabSwitcher";
        this.register(
            this.editorService.onDidChangeMruCycle((state) => {
                if (state !== null) this.show(state);
                else this.hide();
            }),
        );
        // Страховка для смен активной группы, не завершающих серию через модель
        // (сплит и другие структурные пути): оверлей про прежнюю группу не должен
        // пережить уход из неё.
        this.register(
            this.editorService.onDidActiveGroupChange(() => {
                this.hide();
            }),
        );
        this.register({
            dispose: () => {
                this.session?.dispose();
                this.session = null;
            },
        });
    }

    /** Вызывается владельцем корневой view (WorkbenchComponent) до первого показа. */
    public attachHost(host: BodyElement): void {
        this.host = host;
        this.session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            // Пассивный индикатор: фокус остаётся в редакторе, клики проходят
            // насквозь, глобальные бинды (сам Ctrl+Tab) не гасятся.
            // Stryker disable next-line BooleanLiteral: view не focusable — фокус не двигается ни при open, ни при close; флаг фиксирует намерение и наблюдаемого эффекта в тестах не имеет
            restoreFocus: false,
            // Stryker disable next-line BooleanLiteral: та же причина — focusOnOpen некому отдать фокус
            focusOnOpen: false,
            // Escape гасит список тем же путём, что и любая другая клавиша —
            // через конец hold-сессии в модели (ModifierReleaseArmory), а не
            // сессией слоя: закрывать оверлей в обход модели значило бы оставить
            // серию Ctrl+Tab живой при погасшем списке.
            // Stryker disable next-line BooleanLiteral: оба значения дают один наблюдаемый результат — к моменту, когда слой обработал бы Escape, список уже закрыт моделью
            closeOnEscape: false,
            // Stryker disable next-line StringLiteral: клавиатуру гасит явный capturesKeyboard ниже, а по мыши "" ведёт себя как passthrough (не modal и не close-on-outside) — наблюдаемой разницы нет
            pointerPolicy: "passthrough",
            capturesKeyboard: false,
        });
    }

    public isOpen(): boolean {
        return this.session?.isOpen() ?? false;
    }

    /** Отражает шаг серии: строки из замороженного MRU-списка, окно — по позиции. */
    private show(state: MruCycleState): void {
        const labels = computeTabLabels(state.panes, (pane) => this.editorService.displayName(pane));
        const items: TabSwitcherItem[] = state.panes.map((pane, index) => {
            const fi = getFileIcon(this.editorService.displayName(pane));
            return {
                icon: fi.icon,
                iconColor: fi.color,
                label: labels[index],
                isModified: pane.isModified,
            };
        });
        this.updatePosition();
        this.view.setItems(items, state.pointer);
        this.session?.open();
    }

    private hide(): void {
        if (this.session?.isOpen()) this.session.close();
    }

    /** Горизонтальный центр, ~10% от верха экрана — как у quick pick'а. */
    private updatePosition(): void {
        if (this.host === null) return;

        const screenW = this.host.layoutSize.width;
        const screenH = this.host.layoutSize.height;

        const width = Math.min(48, Math.max(24, screenW - 4));
        const px = Math.max(0, Math.floor((screenW - width) / 2));
        const py = Math.max(1, Math.floor(screenH * 0.1));

        this.view.preferredWidth = width;
        // Stryker disable next-line OptionalChaining: host и session ставятся вместе в attachHost, а сюда путь ведёт только через гард host !== null — ветка undefined недостижима
        this.session?.setPosition(new Point(px, py));
    }
}
