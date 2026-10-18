import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { Component } from "../component.ts";

import type { PaneCompositePartService } from "./paneCompositePartService.ts";
import type { IPanelContainerOptions } from "./panel/panelContainerElement.ts";
import { PanelContainerElement } from "./panel/panelContainerElement.ts";

/**
 * Компонент части с таб-строкой контейнеров (нижняя панель, вторичная боковая
 * панель): владеет {@link PanelContainerElement} и отражает в нём реестр своего
 * {@link PaneCompositePartService} — вкладки, их контент и активную вкладку.
 * Про конкретные вкладки ничего не знает: их заводит `ViewsService`. Клик по
 * табу возвращается в сервис (`activateView`) — на нём висят ленивые фичи
 * (спавн терминала).
 */
export class PaneCompositePartComponent extends Component {
    public readonly view: PanelContainerElement;

    /** Контент, отданный контролу для каждой вкладки, — чтобы не перевешивать без нужды. */
    private contents = new Map<string, TUIElement | null>();
    /** То же для контролов шапки — чтобы не перевешивать их на каждый чих. */
    private actions = new Map<string, TUIElement | null>();

    /**
     * @param viewId id корневого контрола — стабильный селектор части для e2e и инспектора.
     * @param closeCommandId команда кнопки `×` в таб-строке.
     */
    protected constructor(
        private readonly partService: PaneCompositePartService,
        commands: CommandRegistry,
        viewId: string,
        closeCommandId: string,
        options?: IPanelContainerOptions,
    ) {
        super();
        this.view = new PanelContainerElement(options);
        this.view.id = viewId;
        // Клик по табу: контрол уже переключил активную вкладку у себя — синхронизируем
        // сервис и даём его подписчикам среагировать (ленивый спавн терминала и т.п.).
        this.view.onActivateView = (id) => {
            this.partService.activateView(id);
        };
        // Кнопка `×` не трогает видимость сама: часть закрывает команда, и это та
        // же дверь, что у кейбинда и у палитры (включая её `enablement`).
        this.view.onClose = () => {
            void commands.execute(closeCommandId);
        };
        this.view.onTabContextMenu = (id, anchor) => {
            this.partService.requestTabContextMenu({ id, anchor, owner: this.view });
        };
        this.register(
            this.partService.onDidChangeViews(() => {
                this.syncViews();
            }),
        );
        this.register(
            this.partService.onDidChangeActiveView((id) => {
                this.view.setActiveView(id);
            }),
        );
        this.syncViews();
    }

    /** Приводит контрол к реестру сервиса: снятые и новые вкладки + изменившийся контент. */
    private syncViews(): void {
        const views = this.partService.getViews();
        for (const id of [...this.contents.keys()]) {
            if (views.some((view) => view.id === id)) continue;
            this.contents.delete(id);
            this.actions.delete(id);
            this.view.removeView(id);
        }
        for (const view of views) {
            if (!this.contents.has(view.id)) {
                // Позиция — та же, что в реестре: вернувшийся контейнер встаёт на
                // своё место по order, а не в хвост таб-строки.
                this.view.addView(
                    {
                        id: view.id,
                        title: view.title,
                        content: view.content,
                        actions: view.actions,
                        placeholder: view.placeholder,
                    },
                    views.indexOf(view),
                );
            } else {
                if (this.contents.get(view.id) !== view.content) this.view.setViewContent(view.id, view.content);
                if (this.actions.get(view.id) !== view.actions) this.view.setViewActions(view.id, view.actions);
            }
            this.contents.set(view.id, view.content);
            this.actions.set(view.id, view.actions);
        }
        const activeId = this.partService.getActiveViewId();
        // Stryker disable next-line ConditionalExpression: «→ true» эквивалентен — null для контрола неизвестный id, setActiveView его пропускает (охрана — ради типа)
        if (activeId !== null) this.view.setActiveView(activeId);
    }
}
