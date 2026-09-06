import { describe, expect, it, vi } from "vitest";

import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { formatKeybinding, KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ProgressService, ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import type { SidebarService } from "../../../browser/parts/sidebar/sidebarService.ts";

import { refreshExtensionsAction, showExtensionsAction } from "./extensionsActions.ts";
import { EXTENSIONS_VIEW_ID, EXTENSIONS_VIEWLET_ID, ExtensionsComponentDIToken } from "./extensionsComponent.ts";
import type { ExtensionsComponent } from "./extensionsComponent.ts";

/** Контейнер с фейками ровно тех сервисов, которые дёргают эти два экшена. */
function makeAccessor(): {
    accessor: Container;
    shown: string[];
    refreshes: number;
    progress: ProgressService;
} {
    const shown: string[] = [];
    let refreshes = 0;
    const accessor = new Container();
    const progress = new ProgressService();
    accessor.bind(SidebarServiceDIToken, () => ({ showViewlet: (id: string) => shown.push(id) }) as unknown as SidebarService);
    accessor.bind(ProgressServiceDIToken, () => progress);
    accessor.bind(
        ExtensionsComponentDIToken,
        () =>
            ({
                refresh: () => {
                    refreshes++;
                    return Promise.resolve();
                },
            }) as unknown as ExtensionsComponent,
    );
    return {
        accessor,
        shown,
        get refreshes() {
            return refreshes;
        },
        progress,
    };
}

describe("extensionsActions", () => {
    it("объявляет id и биндинги как в VS Code", () => {
        expect(showExtensionsAction.id).toBe("workbench.view.extensions");
        expect(refreshExtensionsAction.id).toBe("extensions.refresh");

        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        registerAction(commands, keybindings, accessor, showExtensionsAction);

        expect(commands.has("workbench.view.extensions")).toBe(true);
        const chord = keybindings.getKeybindingForCommand("workbench.view.extensions");
        // Основной путь — leader-аккорд: Ctrl+Shift+X на legacy-терминале
        // неотличим от Ctrl+X, поэтому канонический бинд объявлен условно.
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+K X");
        const [conditional] = showExtensionsAction.keybindings ?? [];
        expect(conditional).toMatchObject({ when: "tier != 'legacy'" });
    });

    it("показ вьюлета переключает сайдбар на магазин", () => {
        const h = makeAccessor();
        showExtensionsAction.run?.(h.accessor);
        expect(h.shown).toEqual([EXTENSIONS_VIEWLET_ID]);
    });

    it("Refresh перечитывает каталог и показывает прогресс в заголовке секции", async () => {
        const h = makeAccessor();
        const start = vi.spyOn(h.progress, "withProgress");

        await refreshExtensionsAction.run?.(h.accessor);

        expect(h.refreshes).toBe(1);
        expect(start).toHaveBeenCalledWith(
            { location: "view", viewId: EXTENSIONS_VIEW_ID, title: "Refreshing extensions" },
            expect.any(Function),
        );
    });

    it("Refresh живёт кнопкой в заголовке своей секции", () => {
        const placement = refreshExtensionsAction.menus?.[0];
        expect(placement?.menuId).toBe(MenuId.ViewTitle);
        expect(placement?.group).toBe("navigation");
        // Кнопка принадлежит только своей секции — фильтр по контексту меню.
        expect(placement?.visible?.({ view: EXTENSIONS_VIEW_ID })).toBe(true);
        expect(placement?.visible?.({ view: "workbench.search.results" })).toBe(false);
        expect(refreshExtensionsAction.when).toBe("extensionsViewletVisible");
    });
});
