import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Emitter } from "../../../base/common/event.ts";

export interface IPaneCompositeViewDescriptor {
    readonly id: string;
    readonly title: string;
    readonly content?: TUIElement | null;
    readonly placeholder?: string;
    readonly index?: number;
}

export interface IPaneCompositeView {
    readonly id: string;
    readonly title: string;
    readonly content: TUIElement | null;
    /** View title row, as in the sidebar but without the name (`ViewContainerHeaderElement`). */
    readonly actions: TUIElement | null;
    readonly placeholder?: string;
}

export interface IPaneCompositeTabContextMenuRequest {
    readonly id: string;
    readonly anchor: { readonly screenX: number; readonly screenY: number };
    /** Used to find the overlay layer to show in. */
    readonly owner: TUIElement;
}

interface PaneCompositeViewRecord {
    readonly id: string;
    readonly title: string;
    content: TUIElement | null;
    actions: TUIElement | null;
    readonly placeholder?: string;
}

/**
 * Common base of the bottom panel and the auxiliary bar (upstream both are
 * `AbstractPaneCompositePart`). `ViewsService` creates and fills the tabs;
 * features never call this directly, they register their views.
 */
export class PaneCompositePartService {
    public static dependencies = [] as const;

    private viewList: PaneCompositeViewRecord[] = [];
    private activeId: string | null = null;
    private visibleState = false;

    private readonly onDidChangeViewsEmitter = new Emitter<void>();
    public readonly onDidChangeViews = this.onDidChangeViewsEmitter.event;

    private readonly onDidChangeActiveViewEmitter = new Emitter<string>();
    public readonly onDidChangeActiveView = this.onDidChangeActiveViewEmitter.event;

    private readonly onDidActivateViewEmitter = new Emitter<string>();
    public readonly onDidActivateView = this.onDidActivateViewEmitter.event;

    private readonly onDidChangeVisibilityEmitter = new Emitter<boolean>();
    public readonly onDidChangeVisibility = this.onDidChangeVisibilityEmitter.event;

    private readonly onDidRequestTabContextMenuEmitter = new Emitter<IPaneCompositeTabContextMenuRequest>();
    /** `ViewsService` builds the entries ("Move To", "Reset Location"): it knows container locations. */
    public readonly onDidRequestTabContextMenu = this.onDidRequestTabContextMenuEmitter.event;

    public requestTabContextMenu(request: IPaneCompositeTabContextMenuRequest): void {
        this.onDidRequestTabContextMenuEmitter.fire(request);
    }

    /** The first registered one becomes active. */
    public addView(view: IPaneCompositeViewDescriptor): void {
        this.viewList.splice(view.index ?? this.viewList.length, 0, {
            id: view.id,
            title: view.title,
            content: view.content ?? null,
            actions: null,
            placeholder: view.placeholder,
        });
        this.activeId ??= view.id;
        this.onDidChangeViewsEmitter.fire();
    }

    /** Removing the active one activates the first remaining one. Unknown id is a no-op. */
    public removeView(id: string): void {
        const index = this.viewList.findIndex((v) => v.id === id);
        if (index < 0) return;
        this.viewList.splice(index, 1);
        const wasActive = this.activeId === id;
        if (wasActive) this.activeId = this.viewList.at(0)?.id ?? null;
        this.onDidChangeViewsEmitter.fire();
        if (wasActive && this.activeId !== null) this.onDidChangeActiveViewEmitter.fire(this.activeId);
    }

    /** Unknown id is a no-op. */
    public setViewContent(id: string, content: TUIElement | null): void {
        const view = this.viewList.find((v) => v.id === id);
        if (view === undefined) return;
        view.content = content;
        this.onDidChangeViewsEmitter.fire();
    }

    /** The tab's feature owns the controls, so they go through the registry like the content. */
    public setViewActions(id: string, actions: TUIElement | null): void {
        const view = this.viewList.find((v) => v.id === id);
        if (view === undefined) return;
        view.actions = actions;
        this.onDidChangeViewsEmitter.fire();
    }

    /** In registration order (tab order). */
    public getViews(): readonly IPaneCompositeView[] {
        return this.viewList;
    }

    /** Without "user clicked" semantics: does not fire {@link onDidActivateView}. */
    public setActiveView(id: string): void {
        if (this.viewList.every((v) => v.id !== id) || this.activeId === id) return;
        this.activeId = id;
        this.onDidChangeActiveViewEmitter.fire(id);
    }

    public getActiveViewId(): string | null {
        return this.activeId;
    }

    /** Fires {@link onDidActivateView}: lazy features listen to it (the terminal spawns a shell). */
    public activateView(id: string): void {
        this.setActiveView(id);
        this.onDidActivateViewEmitter.fire(id);
    }

    /** Source of truth in the registry; layout follows it via a subscription. */
    public get visible(): boolean {
        return this.visibleState;
    }

    public setVisible(visible: boolean): void {
        if (visible === this.visibleState) return;
        this.visibleState = visible;
        this.onDidChangeVisibilityEmitter.fire(visible);
    }
}
