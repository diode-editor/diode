import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import { TitledPanelElement } from "../../../../../../tuidom/ui/titledpanel/titledPanelElement.ts";
import { TreeViewElement } from "../../../../../../tuidom/ui/tree/treeViewElement.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { IFileClipboard } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { getFileTreeStyles, } from "../../../../platform/theme/browser/defaultStyles.ts";
import { ThemedComponent } from "../../../browser/component.ts";
import { FileClipboardDIToken } from "../../../common/coreTokens.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

import type { ExplorerService } from "./explorerService.ts";
import { ExplorerServiceDIToken } from "./explorerService.ts";
import type { FileTreeNode } from "./fileTreeDataProvider.ts";

export const ExplorerComponentDIToken = token<ExplorerComponent>("ExplorerComponent");

/** Id вьюлета Explorer в сайдбаре (см. {@link SidebarService}). */
export const EXPLORER_VIEWLET_ID = "explorer";

interface ExplorerViewParts {
    readonly tree: TreeViewElement<FileTreeNode>;
    readonly scrollBars: ScrollBarDecorator;
    readonly root: TitledPanelElement;
}

/**
 * Компонент Explorer'а (сайдбар с деревом файлов): владеет `TreeViewElement`
 * поверх провайдера {@link ExplorerService} (обёрнутым в скроллбар и рамку
 * EXPLORER), перестраивает дерево по смене корня воркспейса и регистрирует его
 * в сервисе (шов `IExplorerView`). Активация файла уходит в команду
 * `workbench.openFile`; правый клик/Shift+F10 (единое событие "contextmenu"
 * движка) открывают контекстное меню через `ContextMenuService` — делегат с
 * точкой `MenuId.ExplorerContext`, пункты исполняют команды
 * `explorer.*`/`fileOperations.*`.
 */
export class ExplorerComponent extends ThemedComponent {
    public static dependencies = [
        ExplorerServiceDIToken,
        CommandRegistryDIToken,
        FileClipboardDIToken,
        ContextMenuServiceDIToken,
        ThemeServiceDIToken,
    ] as const;

    private parts: ExplorerViewParts | null = null;

    public constructor(
        private readonly explorerService: ExplorerService,
        private readonly commands: CommandRegistry,
        private readonly fileClipboard: IFileClipboard,
        private readonly contextMenuService: ContextMenuService,
        themeService: ThemeService,
    ) {
        super(themeService);
        this.register(
            explorerService.onDidChangeRoot(() => {
                this.rebuild();
            }),
        );
        if (explorerService.provider) {
            this.rebuild();
        }
        this.initStyles();
    }

    /** Корневой контрол. До первого setRootPath сервиса дерева ещё нет (как и раньше у контроллера). */
    public get view(): TUIElement {
        return this.parts?.root as TUIElement;
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
        const root = new TitledPanelElement("  EXPLORER", scrollBars);
        root.id = EXPLORER_VIEWLET_ID;
        this.parts = { tree, scrollBars, root };

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
        this.updateStyles();
    }

    private showContextMenu(tree: TreeViewElement<FileTreeNode>, filePath: string, screenX: number, screenY: number): void {
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

    protected updateStyles(): void {
        // Темы могут приходить и до корня воркспейса — дерева тогда ещё нет.
        if (!this.parts) return;
        this.parts.tree.setStyles(getFileTreeStyles(this.theme));
        this.parts.root.style = {
            fg: this.theme.getRequiredColor("sideBar.foreground"),
            bg: this.theme.getRequiredColor("sideBar.background"),
        };
    }
}
