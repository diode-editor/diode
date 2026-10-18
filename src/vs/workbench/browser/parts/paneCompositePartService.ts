import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Emitter } from "../../../base/common/event.ts";

/** Описание вкладки при регистрации (см. {@link PaneCompositePartService.addView}). */
export interface IPaneCompositeViewDescriptor {
    readonly id: string;
    readonly title: string;
    /** Контент вкладки; null → компонент рендерит {@link placeholder}. */
    readonly content?: TUIElement | null;
    /** Empty-state сообщение, пока `content` = null (à la VS Code view welcome). */
    readonly placeholder?: string;
    /** Позиция вкладки в таб-строке; по умолчанию — в конец. */
    readonly index?: number;
}

/** Зарегистрированная вкладка (снимок для компонента). */
export interface IPaneCompositeView {
    readonly id: string;
    readonly title: string;
    readonly content: TUIElement | null;
    /**
     * Полоса контролов вкладки в шапке: та же строка заголовка view, что в
     * сайдбаре, только без названия (см. `ViewContainerHeaderElement`).
     */
    readonly actions: TUIElement | null;
    readonly placeholder?: string;
}

/** Запрос контекстного меню вкладки: чья вкладка, где открыть, чей это попап. */
export interface IPaneCompositeTabContextMenuRequest {
    readonly id: string;
    readonly anchor: { readonly screenX: number; readonly screenY: number };
    /** Владелец попапа — по нему ищется overlay-слой показа. */
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
 * Реестр вкладок части с таб-строкой контейнеров + её видимость — общая
 * основа нижней панели и вторичной боковой панели (у эталона обе —
 * `AbstractPaneCompositePart`, а вторичная при `activityBar.location=default`
 * показывает контейнеры вкладками в заголовке, как панель).
 *
 * Логика без view: вкладку заводит `ViewsService` — вкладка это контейнер с
 * `location` этой части, и он же подменяет её контент и контролы шапки; фичи
 * в этот реестр не ходят, они регистрируют свои view. Компонент части подписан
 * на `onDidChange*` и отражает реестр в `PanelContainerElement`. Видимость —
 * тоже здесь: toggle-команды зовут {@link setVisible}, `LayoutService` подписан
 * на {@link onDidChangeVisibility} и двигает `WorkbenchLayoutElement` вместе с
 * контекст-ключом видимости части.
 */
export class PaneCompositePartService {
    public static dependencies = [] as const;

    private viewList: PaneCompositeViewRecord[] = [];
    private activeId: string | null = null;
    private visibleState = false;

    private readonly onDidChangeViewsEmitter = new Emitter<void>();
    /** Любое изменение набора вкладок или их контента. */
    public readonly onDidChangeViews = this.onDidChangeViewsEmitter.event;

    private readonly onDidChangeActiveViewEmitter = new Emitter<string>();
    /** Смена активной вкладки (и программная, и пользовательская). */
    public readonly onDidChangeActiveView = this.onDidChangeActiveViewEmitter.event;

    private readonly onDidActivateViewEmitter = new Emitter<string>();
    /** Пользовательская активация вкладки (см. {@link activateView}). */
    public readonly onDidActivateView = this.onDidActivateViewEmitter.event;

    private readonly onDidChangeVisibilityEmitter = new Emitter<boolean>();
    public readonly onDidChangeVisibility = this.onDidChangeVisibilityEmitter.event;

    private readonly onDidRequestTabContextMenuEmitter = new Emitter<IPaneCompositeTabContextMenuRequest>();
    /**
     * Пользователь открыл контекстное меню вкладки. Пункты («Move To»,
     * «Reset Location») собирает `ViewsService` — он знает места контейнеров.
     */
    public readonly onDidRequestTabContextMenu = this.onDidRequestTabContextMenuEmitter.event;

    /** Сообщить о запросе контекстного меню вкладки (зовёт компонент части). */
    public requestTabContextMenu(request: IPaneCompositeTabContextMenuRequest): void {
        this.onDidRequestTabContextMenuEmitter.fire(request);
    }

    /** Регистрирует вкладку. Первая зарегистрированная становится активной. */
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

    /**
     * Снимает вкладку (контейнер уехал в другую часть или опустел). Снятая
     * активная передаёт активность первой оставшейся. Неизвестный id — no-op.
     */
    public removeView(id: string): void {
        const index = this.viewList.findIndex((v) => v.id === id);
        if (index < 0) return;
        this.viewList.splice(index, 1);
        const wasActive = this.activeId === id;
        if (wasActive) this.activeId = this.viewList.at(0)?.id ?? null;
        this.onDidChangeViewsEmitter.fire();
        if (wasActive && this.activeId !== null) this.onDidChangeActiveViewEmitter.fire(this.activeId);
    }

    /** Подменяет контент зарегистрированной вкладки (null → placeholder). Неизвестный id — no-op. */
    public setViewContent(id: string, content: TUIElement | null): void {
        const view = this.viewList.find((v) => v.id === id);
        if (view === undefined) return;
        view.content = content;
        this.onDidChangeViewsEmitter.fire();
    }

    /**
     * Подменяет контролы вкладки в шапке (null — убрать). Их владелец — фича
     * вкладки, поэтому в контрол они попадают не напрямую, а через реестр, как
     * и контент.
     */
    public setViewActions(id: string, actions: TUIElement | null): void {
        const view = this.viewList.find((v) => v.id === id);
        if (view === undefined) return;
        view.actions = actions;
        this.onDidChangeViewsEmitter.fire();
    }

    /** Снимок реестра в порядке регистрации (порядок табов). */
    public getViews(): readonly IPaneCompositeView[] {
        return this.viewList;
    }

    /** Делает вкладку активной (программно, без семантики «пользователь кликнул»). */
    public setActiveView(id: string): void {
        if (this.viewList.every((v) => v.id !== id) || this.activeId === id) return;
        this.activeId = id;
        this.onDidChangeActiveViewEmitter.fire(id);
    }

    public getActiveViewId(): string | null {
        return this.activeId;
    }

    /**
     * Пользовательская активация вкладки (клик по табу): помимо смены активной
     * файрит {@link onDidActivateView} — на него подписаны ленивые фичи
     * (терминал спавнит шелл). Программный {@link setActiveView} этого события
     * не порождает.
     */
    public activateView(id: string): void {
        this.setActiveView(id);
        this.onDidActivateViewEmitter.fire(id);
    }

    /** Видимость части (истина реестра; layout следует за ней через подписку). */
    public get visible(): boolean {
        return this.visibleState;
    }

    public setVisible(visible: boolean): void {
        if (visible === this.visibleState) return;
        this.visibleState = visible;
        this.onDidChangeVisibilityEmitter.fire(visible);
    }
}
