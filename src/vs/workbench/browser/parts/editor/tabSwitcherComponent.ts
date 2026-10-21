import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { MruCycleState } from "../../../services/editor/browser/editorGroupModel.ts";
import type { IEditorGroupsService } from "../../../services/editor/common/editorGroupsService.ts";
import { EditorGroupsServiceDIToken } from "../../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { Component } from "../../component.ts";

import { computeTabLabels } from "./tabLabels.ts";
import { TabSwitcherElement, type TabSwitcherItem } from "./tabSwitcherElement.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TabSwitcherComponentDIToken = token<TabSwitcherComponent>("TabSwitcherComponent");

/**
 * Чисто реактивный: жизнью оверлея управляют события модели
 * ({@link IEditorGroupsService.onDidChangeMruCycle}), командам он неизвестен.
 * Сессия passthrough и без фокуса: ввод идёт в редактор, бинды Ctrl+Tab работают.
 */
export class TabSwitcherComponent extends Component implements IContextKeyContributor {
    public static dependencies = [EditorServiceDIToken, EditorGroupsServiceDIToken] as const;

    public readonly view: TabSwitcherElement;

    private host: BodyElement | null = null;
    private session: OverlaySessionHandle | null = null;

    public constructor(
        private readonly editorService: IEditorService,
        private readonly groups: IEditorGroupsService,
    ) {
        super();
        this.view = new TabSwitcherElement();
        this.view.id = "tabSwitcher";
        this.register(
            this.groups.onDidChangeMruCycle((state) => {
                if (state !== null) this.show(state);
                else this.hide();
            }),
        );
        // Смены активной группы, не завершающие серию через модель (сплит): оверлей
        // про прежнюю группу не должен пережить уход из неё.
        this.register(
            this.groups.onDidActiveGroupChange(() => {
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

    /** До первого показа. */
    public attachHost(host: BodyElement): void {
        this.host = host;
        this.session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            // Stryker disable next-line BooleanLiteral: view не focusable — фокус не двигается ни при open, ни при close; флаг фиксирует намерение и наблюдаемого эффекта в тестах не имеет
            restoreFocus: false,
            // Stryker disable next-line BooleanLiteral: та же причина — focusOnOpen некому отдать фокус
            focusOnOpen: false,
            // Escape гасит список через конец серии в модели: закрыть оверлей сессией
            // слоя значило бы оставить серию Ctrl+Tab живой при погасшем списке.
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

    /**
     * Спрашиваем ВИДИМОСТЬ оверлея, а не состояние серии: список гаснет и помимо
     * конца серии, а стрелки обязаны вернуться редактору ровно когда он исчез.
     */
    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("tabSwitcherVisible", this.isOpen());
    }

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

    /** ~10% от верха экрана — как у quick pick'а. */
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
