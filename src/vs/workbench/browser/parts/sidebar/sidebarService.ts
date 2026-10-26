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
 * Counterpart of VS Code `IViewletService` without an activity bar: `workbench.view.*`
 * commands switch viewlets. **Only** `ViewsService` registers viewlets. The
 * "viewlet visible" keys are pull-based: sidebar visibility also changes bypassing the
 * service (Ctrl+B, layout restore), and polling before a key press never misses it.
 */
export class SidebarService implements IContextKeyContributor {
    public static dependencies = [LayoutServiceDIToken] as const;

    private readonly viewlets = new Map<string, ISidebarViewlet>();
    private activeId: string | null = null;
    private readonly onDidChangeActiveViewletEmitter = new Emitter<string>();

    /** Both the startup setup and the show command. */
    public readonly onDidChangeActiveViewlet = this.onDidChangeActiveViewletEmitter.event;

    public constructor(private readonly layout: LayoutService) {}

    /** Registering again replaces the previous one. */
    public registerViewlet(
        id: string,
        view: TUIElement,
        focus: () => void,
        visibleContextKey?: BooleanContextKey,
    ): void {
        this.viewlets.set(id, { view, focus, visibleContextKey });
    }

    /** `ViewsService` decides which viewlet replaces a removed active one. */
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
     * `reveal: false` (startup setup) sets only the content and leaves visibility alone:
     * persisted layout restores it. `focus: false` reveals without taking the keyboard (upstream
     * `openPaneComposite(id, location, focus)`). Unknown id is a no-op.
     */
    public showViewlet(id: string, reveal = true, focus = true): void {
        const viewlet = this.viewlets.get(id);
        if (viewlet === undefined) return;
        const changed = this.activeId !== id;
        this.activeId = id;
        this.layout.setSidebarContent(viewlet.view);
        if (changed) this.onDidChangeActiveViewletEmitter.fire(id);
        if (reveal) {
            this.layout.setSidebarVisible(true);
            if (focus) viewlet.focus();
        }
    }
}
