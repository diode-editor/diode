import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKey, ContextKeyTypes } from "../../../../platform/contextkey/common/contextKeys.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

export const SidebarServiceDIToken = token<SidebarService>("SidebarService");

/** Имя булева контекст-ключа — такими объявляются ключи «вьюлет показан». */
export type BooleanContextKey = { [K in ContextKey]: ContextKeyTypes[K] extends boolean ? K : never }[ContextKey];

/** Зарегистрированный вьюлет сайдбара: его корневой контрол + как его сфокусировать. */
interface ISidebarViewlet {
    readonly view: TUIElement;
    readonly focus: () => void;
    /** Ключ «вьюлет показан» (`searchViewletVisible`…) — из дескриптора контейнера. */
    readonly visibleContextKey: BooleanContextKey | undefined;
}

/**
 * Реестр вьюлетов сайдбара (левой панели) и переключатель между ними — Explorer,
 * Search, Source Control. У нас нет activity bar: роль переключателя играют
 * команды (`workbench.view.explorer` / `workbench.view.search` /
 * `workbench.view.scm`), а показ вьюлета — это подмена контента сайдбара через
 * {@link LayoutService} (`setSidebarContent`). Аналог `IViewletService`/
 * `ActivityBar` в VS Code, только без визуального бара.
 *
 * Вьюлет = контейнер view-секций, и регистрирует их сюда **только**
 * `ViewsService` (`attachContainer` для `location: "sidebar"`): фичи приносят
 * не контрол, а дескриптор своей view.
 *
 * Ключи «вьюлет показан» выставляет здесь же, одним генериком
 * (IContextKeyContributor): ключ объявляет дескриптор контейнера
 * (`visibleContextKey`), истинен он, когда сайдбар виден и вьюлет активен.
 * Тайминг pull — видимость сайдбара меняется и мимо этого сервиса (Ctrl+B,
 * восстановление layout'а), а опрос перед нажатием её не пропустит.
 */
export class SidebarService implements IContextKeyContributor {
    public static dependencies = [LayoutServiceDIToken] as const;

    private readonly viewlets = new Map<string, ISidebarViewlet>();
    private activeId: string | null = null;

    public constructor(private readonly layout: LayoutService) {}

    /** Регистрирует вьюлет под id (Explorer, SCM). Повторная регистрация заменяет. */
    public registerViewlet(
        id: string,
        view: TUIElement,
        focus: () => void,
        visibleContextKey?: BooleanContextKey,
    ): void {
        this.viewlets.set(id, { view, focus, visibleContextKey });
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
     * Делает вьюлет активным: подменяет контент сайдбара. При `reveal` (клик по
     * команде показа) ещё и раскрывает сайдбар и отдаёт вьюлету фокус; при
     * `reveal: false` (стартовая установка) — только контент, не трогая видимость,
     * которую восстанавливает персист layout'а. Неизвестный id — no-op.
     */
    public showViewlet(id: string, reveal = true): void {
        const viewlet = this.viewlets.get(id);
        if (viewlet === undefined) return;
        this.activeId = id;
        this.layout.setSidebarContent(viewlet.view);
        if (reveal) {
            this.layout.setSidebarVisible(true);
            viewlet.focus();
        }
    }
}
