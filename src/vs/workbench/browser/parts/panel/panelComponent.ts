import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { PanelContainerElement } from "../../../../../../tuidom/ui/panel/panelContainerElement.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../component.ts";

import type { PanelService } from "./panelService.ts";
import { PanelServiceDIToken } from "./panelService.ts";

export const PanelComponentDIToken = token<PanelComponent>("PanelComponent");

/**
 * Компонент нижней панели: владеет {@link PanelContainerElement} и отражает в
 * нём реестр {@link PanelService} — вкладки, их контент и активную вкладку.
 * Про конкретные вкладки (Problems, Terminal) ничего не знает: их регистрируют
 * фичи через сервис. Клик по табу возвращается в сервис
 * (`PanelService.activateView`) — на нём висят ленивые фичи (спавн терминала).
 */
export class PanelComponent extends Component {
    public static dependencies = [PanelServiceDIToken] as const;

    public readonly view: PanelContainerElement;

    /** Контент, отданный контролу для каждой вкладки, — чтобы не перевешивать без нужды. */
    private contents = new Map<string, TUIElement | null>();
    /** То же для контролов шапки — чтобы не перевешивать их на каждый чих. */
    private actions = new Map<string, TUIElement | null>();

    public constructor(private readonly panelService: PanelService) {
        super();
        this.view = new PanelContainerElement();
        this.view.id = "panel";
        // Клик по табу: контрол уже переключил активную вкладку у себя — синхронизируем
        // сервис и даём его подписчикам среагировать (ленивый спавн терминала и т.п.).
        this.view.onActivateView = (id) => {
            this.panelService.activateView(id);
        };
        this.register(
            this.panelService.onDidChangeViews(() => {
                this.syncViews();
            }),
        );
        this.register(
            this.panelService.onDidChangeActiveView((id) => {
                this.view.setActiveView(id);
            }),
        );
        this.syncViews();
    }

    /** Приводит контрол к реестру сервиса: новые вкладки + изменившийся контент. */
    private syncViews(): void {
        for (const view of this.panelService.getViews()) {
            if (!this.contents.has(view.id)) {
                this.contents.set(view.id, view.content);
                this.actions.set(view.id, view.actions);
                this.view.addView({
                    id: view.id,
                    title: view.title,
                    content: view.content,
                    actions: view.actions,
                    placeholder: view.placeholder,
                });
            } else if (this.contents.get(view.id) !== view.content) {
                this.contents.set(view.id, view.content);
                this.view.setViewContent(view.id, view.content);
            }
            if (this.actions.get(view.id) !== view.actions) {
                this.actions.set(view.id, view.actions);
                this.view.setViewActions(view.id, view.actions);
            }
        }
        const activeId = this.panelService.getActiveViewId();
        if (activeId !== null) this.view.setActiveView(activeId);
    }
}
