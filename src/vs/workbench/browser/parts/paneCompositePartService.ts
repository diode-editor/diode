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
    /** Строка заголовка view, как в сайдбаре, но без названия (`ViewContainerHeaderElement`). */
    readonly actions: TUIElement | null;
    readonly placeholder?: string;
}

export interface IPaneCompositeTabContextMenuRequest {
    readonly id: string;
    readonly anchor: { readonly screenX: number; readonly screenY: number };
    /** По нему ищется overlay-слой показа. */
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
 * Общая основа нижней панели и вторичной боковой (у эталона обе —
 * `AbstractPaneCompositePart`). Вкладку заводит и наполняет `ViewsService` —
 * фичи сюда не ходят, они регистрируют свои view.
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
    /** Пункты («Move To», «Reset Location») собирает `ViewsService` — он знает места контейнеров. */
    public readonly onDidRequestTabContextMenu = this.onDidRequestTabContextMenuEmitter.event;

    public requestTabContextMenu(request: IPaneCompositeTabContextMenuRequest): void {
        this.onDidRequestTabContextMenuEmitter.fire(request);
    }

    /** Первая зарегистрированная становится активной. */
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

    /** Снятая активная передаёт активность первой оставшейся. Неизвестный id — no-op. */
    public removeView(id: string): void {
        const index = this.viewList.findIndex((v) => v.id === id);
        if (index < 0) return;
        this.viewList.splice(index, 1);
        const wasActive = this.activeId === id;
        if (wasActive) this.activeId = this.viewList.at(0)?.id ?? null;
        this.onDidChangeViewsEmitter.fire();
        if (wasActive && this.activeId !== null) this.onDidChangeActiveViewEmitter.fire(this.activeId);
    }

    /** Неизвестный id — no-op. */
    public setViewContent(id: string, content: TUIElement | null): void {
        const view = this.viewList.find((v) => v.id === id);
        if (view === undefined) return;
        view.content = content;
        this.onDidChangeViewsEmitter.fire();
    }

    /** Владелец контролов — фича вкладки, поэтому они, как и контент, идут через реестр. */
    public setViewActions(id: string, actions: TUIElement | null): void {
        const view = this.viewList.find((v) => v.id === id);
        if (view === undefined) return;
        view.actions = actions;
        this.onDidChangeViewsEmitter.fire();
    }

    /** В порядке регистрации (порядок табов). */
    public getViews(): readonly IPaneCompositeView[] {
        return this.viewList;
    }

    /** Без семантики «пользователь кликнул» — {@link onDidActivateView} не файрит. */
    public setActiveView(id: string): void {
        if (this.viewList.every((v) => v.id !== id) || this.activeId === id) return;
        this.activeId = id;
        this.onDidChangeActiveViewEmitter.fire(id);
    }

    public getActiveViewId(): string | null {
        return this.activeId;
    }

    /** Файрит {@link onDidActivateView}: на него подписаны ленивые фичи (терминал спавнит шелл). */
    public activateView(id: string): void {
        this.setActiveView(id);
        this.onDidActivateViewEmitter.fire(id);
    }

    /** Истина реестра; layout следует за ней через подписку. */
    public get visible(): boolean {
        return this.visibleState;
    }

    public setVisible(visible: boolean): void {
        if (visible === this.visibleState) return;
        this.visibleState = visible;
        this.onDidChangeVisibilityEmitter.fire(visible);
    }
}
