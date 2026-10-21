import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { Component } from "../component.ts";

import type { PaneCompositePartService } from "./paneCompositePartService.ts";
import type { IPanelContainerOptions } from "./panel/panelContainerElement.ts";
import { PanelContainerElement } from "./panel/panelContainerElement.ts";

/** A tab click goes back to the service (`activateView`): lazy features (terminal spawn) listen there. */
export class PaneCompositePartComponent extends Component {
    public readonly view: PanelContainerElement;

    /** Avoids re-attaching content when nothing changed. */
    private contents = new Map<string, TUIElement | null>();
    private actions = new Map<string, TUIElement | null>();

    /** @param viewId stable selector of the part for e2e and the inspector. */
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
        // The control has already switched its tab; sync the service.
        this.view.onActivateView = (id) => {
            this.partService.activateView(id);
        };
        // `×` does not change visibility itself: it goes through the same command as the keybinding and palette (including `enablement`).
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
            // Stryker disable next-line CallExpression: a returning tab is recognized by contents and the addView branch below overwrites its actions; an orphan in the map is unobservable
            this.actions.delete(id);
            this.view.removeView(id);
        }
        for (const view of views) {
            if (!this.contents.has(view.id)) {
                // A returning container takes its place by order, not at the end.
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
        // Stryker disable next-line ConditionalExpression: "→ true" is equivalent — null is an unknown id for the control and setActiveView skips it (the guard is for the type)
        if (activeId !== null) this.view.setActiveView(activeId);
    }
}
