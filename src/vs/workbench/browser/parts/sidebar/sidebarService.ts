import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

export const SidebarServiceDIToken = token<SidebarService>("SidebarService");

/** Зарегистрированный вьюлет сайдбара: его корневой контрол + как его сфокусировать. */
interface ISidebarViewlet {
    readonly view: TUIElement;
    readonly focus: () => void;
}

/**
 * Реестр вьюлетов сайдбара (левой панели) и переключатель между ними — Explorer
 * и Source Control. Заменяет захардкоженный Explorer: у нас нет activity bar, роль
 * переключателя играют команды (`workbench.view.explorer` / `workbench.view.scm`),
 * а показ вьюлета — это подмена контента сайдбара через {@link LayoutService}
 * (`setSidebarContent`). Аналог `IViewletService`/`ActivityBar` в VS Code, только
 * без визуального бара.
 */
export class SidebarService {
    public static dependencies = [LayoutServiceDIToken] as const;

    private readonly viewlets = new Map<string, ISidebarViewlet>();
    private activeId: string | null = null;

    public constructor(private readonly layout: LayoutService) {}

    /** Регистрирует вьюлет под id (Explorer, SCM). Повторная регистрация заменяет. */
    public registerViewlet(id: string, view: TUIElement, focus: () => void): void {
        this.viewlets.set(id, { view, focus });
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
