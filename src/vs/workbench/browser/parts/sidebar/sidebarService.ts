import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Emitter } from "../../../../base/common/event.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKey, ContextKeyTypes } from "../../../../platform/contextkey/common/contextKeys.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

export const SidebarServiceDIToken = token<SidebarService>("SidebarService");

export type BooleanContextKey = { [K in ContextKey]: ContextKeyTypes[K] extends boolean ? K : never }[ContextKey];

interface ISidebarViewlet {
    readonly view: TUIElement;
    readonly focus: () => void;
    readonly visibleContextKey: BooleanContextKey | undefined;
}

/**
 * Аналог `IViewletService` VS Code без activity bar: переключают команды
 * `workbench.view.*`. Регистрирует вьюлеты **только** `ViewsService`. Ключи
 * «вьюлет показан» — pull: видимость сайдбара меняется и мимо сервиса (Ctrl+B,
 * восстановление layout'а), а опрос перед нажатием её не пропустит.
 */
export class SidebarService implements IContextKeyContributor {
    public static dependencies = [LayoutServiceDIToken] as const;

    private readonly viewlets = new Map<string, ISidebarViewlet>();
    private activeId: string | null = null;
    private readonly onDidChangeActiveViewletEmitter = new Emitter<string>();

    /** И стартовая установка, и команда показа. */
    public readonly onDidChangeActiveViewlet = this.onDidChangeActiveViewletEmitter.event;

    public constructor(private readonly layout: LayoutService) {}

    /** Повторная регистрация заменяет. */
    public registerViewlet(
        id: string,
        view: TUIElement,
        focus: () => void,
        visibleContextKey?: BooleanContextKey,
    ): void {
        this.viewlets.set(id, { view, focus, visibleContextKey });
    }

    /** Какой вьюлет показать вместо снятого активного, решает `ViewsService`. */
    public unregisterViewlet(id: string): void {
        if (!this.viewlets.delete(id) || this.activeId !== id) return;
        this.activeId = null;
        this.layout.setSidebarContent(null);
    }

    public isViewletVisible(id: string): boolean {
        return this.activeId === id && this.layout.isSidebarVisible();
    }

    public hideViewlet(id: string): void {
        if (this.activeId === id) this.layout.setSidebarVisible(false);
    }

    public updateContextKeys(contextKeys: ContextKeyService): void {
        const sidebarVisible = this.layout.isSidebarVisible();
        for (const [id, viewlet] of this.viewlets) {
            if (viewlet.visibleContextKey === undefined) continue;
            contextKeys.set(viewlet.visibleContextKey, sidebarVisible && this.activeId === id);
        }
    }

    public getActiveViewletId(): string | null {
        return this.activeId;
    }

    /**
     * `reveal: false` (стартовая установка) — только контент, не трогая видимость:
     * её восстанавливает персист layout'а. Неизвестный id — no-op.
     */
    public showViewlet(id: string, reveal = true): void {
        const viewlet = this.viewlets.get(id);
        if (viewlet === undefined) return;
        const changed = this.activeId !== id;
        this.activeId = id;
        this.layout.setSidebarContent(viewlet.view);
        if (changed) this.onDidChangeActiveViewletEmitter.fire(id);
        if (reveal) {
            this.layout.setSidebarVisible(true);
            viewlet.focus();
        }
    }
}
