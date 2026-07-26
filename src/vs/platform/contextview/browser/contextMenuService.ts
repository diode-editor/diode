import { ContextMenuController } from "../../../../../tuidom/ui/contextview/contextMenuController.ts";
import type { MenuEntry } from "../../../../../tuidom/ui/menu/popupMenuElement.ts";
import type { IMenuStyles } from "../../../../../tuidom/ui/menu/popupMenuItemElement.tsx";
import type { MenuId } from "../../actions/common/menuId.ts";
import type { MenuService } from "../../actions/common/menuService.ts";
import { MenuServiceDIToken } from "../../actions/common/menuService.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { IContextMenuDelegate, IContextMenuMenuDelegate } from "../common/contextMenuDelegate.ts";

export const ContextMenuServiceDIToken = token<ContextMenuService>("ContextMenuService");

function isMenuDelegate(delegate: IContextMenuDelegate | IContextMenuMenuDelegate): delegate is IContextMenuMenuDelegate {
    return "menuId" in delegate;
}

/**
 * Сервис контекстных меню (аналог `ContextMenuService` VS Code): собирает
 * пункты — свои от делегата и/или реестровые по `menuId` (через сепаратор,
 * как `ContextMenuMenuDelegate.transform` в upstream) — и показывает их
 * tuidom-механикой ({@link ContextMenuController}). Пустое меню не открывается.
 */
export class ContextMenuService {
    public static dependencies = [MenuServiceDIToken] as const;

    /**
     * Поставщик темизированных стилей меню; прикрепляет WorkbenchComponent
     * (как attachHost у DialogService). Без него меню идёт unthemed-дефолтами.
     */
    public menuStyles: (() => IMenuStyles) | null = null;

    private readonly controller = new ContextMenuController();

    public constructor(private readonly menuService: MenuService) {}

    public showContextMenu(delegate: IContextMenuDelegate | IContextMenuMenuDelegate): void {
        const entries = this.collectEntries(delegate);
        if (entries.length === 0) return;

        this.controller.show({
            owner: delegate.getOwner(),
            anchor: delegate.getAnchor(),
            entries,
            styles: this.menuStyles?.(),
            onHide: () => delegate.onHide?.(),
        });
    }

    public hideContextMenu(): void {
        this.controller.hide();
    }

    public isContextMenuVisible(): boolean {
        return this.controller.isOpen();
    }

    /** Свои пункты делегата + реестровые, разделённые сепаратором (только между непустыми половинами). */
    private collectEntries(delegate: IContextMenuDelegate | IContextMenuMenuDelegate): MenuEntry[] {
        const own = delegate.getEntries?.() ?? [];
        let registry: MenuEntry[] = [];
        if (isMenuDelegate(delegate)) {
            registry = this.collectRegistryEntries(delegate.menuId, delegate.menuContext, new Set());
        }
        if (own.length > 0 && registry.length > 0) {
            return [...own, { type: "separator" }, ...registry];
        }
        return own.length > 0 ? own : registry;
    }

    /**
     * Рекурсивная сборка точки реестра: submenu-записи резолвятся во вложенные
     * попапы (eager, на момент открытия — `when` учитывается сейчас). Пустые
     * подменю выбрасываются; `seen` рвёт циклы `MenuId` (как `submenuIds` в
     * vscode `menu.ts`).
     */
    private collectRegistryEntries(menuId: MenuId, context: unknown, seen: Set<MenuId>): MenuEntry[] {
        if (seen.has(menuId)) return [];
        seen.add(menuId);
        const menu = this.menuService.createMenu(menuId);
        const entries = menu.getEntries(context, (submenu) => {
            const nested = this.collectRegistryEntries(submenu.submenu, context, seen);
            if (nested.length === 0) return null;
            return { type: "submenu", label: submenu.title, entries: nested };
        });
        menu.dispose();
        return entries;
    }
}
