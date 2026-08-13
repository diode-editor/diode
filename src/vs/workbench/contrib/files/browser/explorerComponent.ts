import type { TUIElement } from "@tuidom/all/dom/tuiElement";
import { ScrollBarDecorator } from "@tuidom/all/ui/scrollbar/scrollContainerElement";
import { TreeViewElement } from "@tuidom/all/ui/tree/treeViewElement";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { IFileClipboard } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { FileClipboardDIToken } from "../../../common/coreTokens.ts";
import {} from "../../../services/themes/common/themeTokens.ts";

import type { ExplorerService } from "./explorerService.ts";
import { ExplorerServiceDIToken } from "./explorerService.ts";
import type { FileTreeNode } from "./fileTreeDataProvider.ts";

export const ExplorerComponentDIToken = token<ExplorerComponent>("ExplorerComponent");

/** Id контейнера Explorer в сайдбаре (см. {@link SidebarService}). */
export const EXPLORER_VIEWLET_ID = "explorer";

/** Id единственной view контейнера — дерева файлов (VS Code `workbench.explorer.fileView`). */
export const EXPLORER_VIEW_ID = "workbench.explorer.fileView";

interface ExplorerViewParts {
    readonly tree: TreeViewElement<FileTreeNode>;
    readonly scrollBars: ScrollBarDecorator;
}

/**
 * Компонент Explorer'а (сайдбар с деревом файлов): владеет `TreeViewElement`
 * поверх провайдера {@link ExplorerService} (обёрнутым в скроллбар),
 * перестраивает дерево по смене корня воркспейса и регистрирует его в сервисе
 * (шов `IExplorerView`). Заголовок, «⋯»-меню и сворачивание даёт общая модель
 * view-контейнеров ({@link ViewsService}) — компонент отдаёт ей только тело
 * секции ({@link ViewsService.setViewBody}), поэтому смена корня не пересоздаёт
 * вьюлет и не рвёт ссылку, которую держит сайдбар.
 *
 * Активация файла уходит в команду `workbench.openFile`; правый клик/Shift+F10
 * (единое событие "contextmenu" движка) открывают контекстное меню через
 * `ContextMenuService` — делегат с точкой `MenuId.ExplorerContext`, пункты
 * исполняют команды `explorer.*`/`fileOperations.*`.
 */
export class ExplorerComponent extends Component {
    public static dependencies = [
        ExplorerServiceDIToken,
        CommandRegistryDIToken,
        FileClipboardDIToken,
        ContextMenuServiceDIToken,
        ViewsServiceDIToken,
    ] as const;

    private parts: ExplorerViewParts | null = null;

    public constructor(
        private readonly explorerService: ExplorerService,
        private readonly commands: CommandRegistry,
        private readonly fileClipboard: IFileClipboard,
        private readonly contextMenuService: ContextMenuService,
        private readonly viewsService: ViewsService,
    ) {
        super();
        // Пустое тело до первого setRootPath: пока папка не открыта, секция
        // рисует подсказку — как view welcome в VS Code.
        viewsService.registerView({
            id: EXPLORER_VIEW_ID,
            containerId: EXPLORER_VIEWLET_ID,
            title: "EXPLORER",
            order: 10,
            body: null,
            placeholder: "No folder opened.",
            focus: () => {
                this.explorerService.focus();
            },
        });
        this.register(
            explorerService.onDidChangeRoot(() => {
                this.rebuild();
            }),
        );
        if (explorerService.provider) {
            this.rebuild();
        }
    }

    /** Тело секции. До первого setRootPath сервиса дерева ещё нет (как и раньше у контроллера). */
    public get view(): TUIElement {
        return this.parts?.scrollBars as TUIElement;
    }

    /** Пересоздаёт дерево под новый провайдер сервиса и регистрирует его как view сервиса. */
    private rebuild(): void {
        const provider = this.explorerService.provider;
        /* v8 ignore start -- defensive: onDidChangeRoot only fires from setRootPath, where the provider is (re)created */
        if (!provider) return;
        /* v8 ignore stop */
        // Отступ контента в 1 колонку живёт внутри дерева, а не во внешнем
        // паддинг-контейнере: так подсветка курсора заливает строку от края панели.
        const tree = new TreeViewElement<FileTreeNode>(provider, { leftPadding: 1 });
        const scrollBars = new ScrollBarDecorator(tree);
        scrollBars.id = "explorerView";
        scrollBars.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.parts = { tree, scrollBars };

        tree.onExpandedChanged = (node, expanded) => {
            if (expanded) {
                provider.watchDirectory(node.path);
            } else {
                provider.unwatchDirectory(node.path);
            }
        };
        tree.onActivate = (node) => {
            if (!node.isDirectory) {
                this.commands.execute("workbench.openFile", node.path);
            }
        };
        tree.onContextMenu = (node, screenX, screenY) => {
            this.showContextMenu(tree, node.path, screenX, screenY);
        };

        this.explorerService.attachView(tree);
        this.viewsService.setViewBody(EXPLORER_VIEW_ID, scrollBars);
    }

    private showContextMenu(
        tree: TreeViewElement<FileTreeNode>,
        filePath: string,
        screenX: number,
        screenY: number,
    ): void {
        // Контекст открытия несёт путь узла (args команд) и признак непустого
        // буфера (видимость Paste); пункты собирает ContextMenuService из
        // MenuId.ExplorerContext.
        this.contextMenuService.showContextMenu({
            getOwner: () => tree,
            getAnchor: () => ({ screenX, screenY }),
            menuId: MenuId.ExplorerContext,
            menuContext: { path: filePath, canPaste: this.fileClipboard.read() !== null },
        });
    }
}
