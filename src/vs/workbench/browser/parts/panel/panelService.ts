import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Emitter } from "../../../../base/common/event.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export const PanelServiceDIToken = token<PanelService>("PanelService");

/** Описание вкладки нижней панели при регистрации (см. {@link PanelService.addView}). */
export interface IPanelViewDescriptor {
    readonly id: string;
    readonly title: string;
    /** Контент вкладки; null → компонент рендерит {@link placeholder}. */
    readonly content?: TUIElement | null;
    /** Empty-state сообщение, пока `content` = null (à la VS Code view welcome). */
    readonly placeholder?: string;
    /** Позиция вкладки в таб-строке; по умолчанию — в конец. */
    readonly index?: number;
}

/** Зарегистрированная вкладка нижней панели (снимок для компонента). */
export interface IPanelView {
    readonly id: string;
    readonly title: string;
    readonly content: TUIElement | null;
    /**
     * Полоса контролов вкладки в шапке панели: та же строка заголовка view, что
     * в сайдбаре, только без названия (см. `ViewContainerHeaderElement`).
     */
    readonly actions: TUIElement | null;
    readonly placeholder?: string;
}

interface PanelViewRecord {
    readonly id: string;
    readonly title: string;
    content: TUIElement | null;
    actions: TUIElement | null;
    readonly placeholder?: string;
}

/**
 * Таб-строка нижней **Panel** (VS Code `ViewContainerLocation.Panel`) + её
 * видимость. Логика без view: вкладку заводит `ViewsService` — вкладка это
 * контейнер с `location: "panel"`, и он же подменяет её контент и контролы
 * шапки; фичи в этот реестр не ходят, они регистрируют свои view.
 * `PanelComponent` подписан на `onDidChange*` и отражает реестр в
 * `PanelContainerElement`. Видимость — тоже здесь: toggle-команды зовут
 * {@link setVisible}, владелец layout'а (сейчас `WorkbenchComponent`) подписан
 * на {@link onDidChangeVisibility} и двигает `WorkbenchLayoutElement` +
 * контекст-ключ `panelVisible`.
 */
export class PanelService {
    public static dependencies = [] as const;

    private viewList: PanelViewRecord[] = [];
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

    /** Регистрирует вкладку. Первая зарегистрированная становится активной. */
    public addView(view: IPanelViewDescriptor): void {
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

    /** Подменяет контент зарегистрированной вкладки (null → placeholder). Неизвестный id — no-op. */
    public setViewContent(id: string, content: TUIElement | null): void {
        const view = this.viewList.find((v) => v.id === id);
        if (view === undefined) return;
        view.content = content;
        this.onDidChangeViewsEmitter.fire();
    }

    /**
     * Подменяет контролы вкладки в шапке панели (null — убрать). Их владелец —
     * фича вкладки, поэтому в контрол они попадают не напрямую, а через реестр,
     * как и контент.
     */
    public setViewActions(id: string, actions: TUIElement | null): void {
        const view = this.viewList.find((v) => v.id === id);
        if (view === undefined) return;
        view.actions = actions;
        this.onDidChangeViewsEmitter.fire();
    }

    /** Снимок реестра в порядке регистрации (порядок табов панели). */
    public getViews(): readonly IPanelView[] {
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

    /** Видимость панели (истина реестра; layout следует за ней через подписку). */
    public get visible(): boolean {
        return this.visibleState;
    }

    public setVisible(visible: boolean): void {
        if (visible === this.visibleState) return;
        this.visibleState = visible;
        this.onDidChangeVisibilityEmitter.fire(visible);
    }
}
