import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { Component } from "../component.ts";

import type { PaneCompositePartService } from "./paneCompositePartService.ts";
import type { IPanelContainerOptions } from "./panel/panelContainerElement.ts";
import { PanelContainerElement } from "./panel/panelContainerElement.ts";

/** Клик по табу возвращается в сервис (`activateView`) — на нём висят ленивые фичи (спавн терминала). */
export class PaneCompositePartComponent extends Component {
    public readonly view: PanelContainerElement;

    /** Чтобы не перевешивать контент без нужды. */
    private contents = new Map<string, TUIElement | null>();
    private actions = new Map<string, TUIElement | null>();

    /** @param viewId стабильный селектор части для e2e и инспектора. */
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
        // Контрол уже переключил вкладку у себя — синхронизируем сервис.
        this.view.onActivateView = (id) => {
            this.partService.activateView(id);
        };
        // `×` не трогает видимость сама: та же дверь, что у кейбинда и палитры (включая `enablement`).
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

    private syncViews(): void {
        const views = this.partService.getViews();
        for (const id of [...this.contents.keys()]) {
            if (views.some((view) => view.id === id)) continue;
            this.contents.delete(id);
            // Stryker disable next-line CallExpression: вернувшуюся вкладку узнают по contents — её actions перепишет addView-ветка ниже; сирота в карте ненаблюдаем
            this.actions.delete(id);
            this.view.removeView(id);
        }
        for (const view of views) {
            if (!this.contents.has(view.id)) {
                // Вернувшийся контейнер встаёт на своё место по order, а не в хвост.
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
