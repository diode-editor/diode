import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { IFileClipboard } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import { FileClipboardDIToken } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { IViewWelcomeBlock } from "../../../browser/parts/views/viewWelcomeElement.ts";
import {} from "../../../services/themes/common/themeTokens.ts";

import type { ExplorerService } from "./explorerService.ts";
import { ExplorerServiceDIToken } from "./explorerService.ts";
import type { FileTreeNode } from "./fileTreeDataProvider.ts";

export const ExplorerComponentDIToken = token<ExplorerComponent>("ExplorerComponent");

export const EXPLORER_VIEWLET_ID = "explorer";

export const EXPLORER_VIEW_ID = "workbench.explorer.fileView";

/** Папка не открыта (редактор поднят на файле или без аргументов). Текст — эталонный. */
const EXPLORER_WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "You have not yet opened a folder." },
    { kind: "text", text: "" },
    { kind: "button", label: "Open Folder", command: "workbench.action.files.openFolder" },
];

interface ExplorerViewParts {
    readonly tree: TreeViewElement<FileTreeNode>;
    readonly scrollBars: ScrollBarDecorator;
}

/**
 * Отдаёт ViewsService только тело секции ({@link ViewsService.setViewBody}), поэтому смена
 * корня не пересоздаёт вьюлет и не рвёт ссылку, которую держит сайдбар.
 */
export class ExplorerComponent extends Component implements IContextKeyContributor {
    public static dependencies = [
        ExplorerServiceDIToken,
        CommandRegistryDIToken,
        FileClipboardDIToken,
        ContextMenuServiceDIToken,
        ViewsServiceDIToken,
        IConfigurationServiceDIToken,
    ] as const;

    private parts: ExplorerViewParts | null = null;

    public constructor(
        private readonly explorerService: ExplorerService,
        private readonly commands: CommandRegistry,
        private readonly fileClipboard: IFileClipboard,
        private readonly contextMenuService: ContextMenuService,
        private readonly viewsService: ViewsService,
        private readonly configurationService: IConfigurationService,
    ) {
        super();
        // Пока папка не открыта, секция рисует welcome, как `viewsWelcome` VS Code; кнопки Clone
        // Repository нет — нет и команды клона.
        viewsService.registerContainer({
            id: EXPLORER_VIEWLET_ID,
            title: "EXPLORER",
            // Stryker disable next-line StringLiteral: ViewsService различает только "panel"; любое другое значение (в том числе испорченное) уходит в сайдбар, так что подмена строки наблюдаемого эффекта не имеет
            location: "sidebar",
            order: 0,
            isDefault: true,
        });
        viewsService.registerView({
            canMoveView: true,
            id: EXPLORER_VIEW_ID,
            containerId: EXPLORER_VIEWLET_ID,
            title: "EXPLORER",
            order: 10,
            body: null,
            placeholder: EXPLORER_WELCOME,
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

    /** До первого setRootPath дерева ещё нет. */
    public get view(): TUIElement {
        return this.parts?.scrollBars as TUIElement;
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("filesExplorerFocus", this.containsFocus(active));
        // Эталонные ключи компактной строки под курсором (`explorerView.onFocusChanged`
        // + `updateCompressedNavigationContextKeys`): гейтят Left/Right/Home/End.
        const compressed = this.explorerService.getCompressedFocus();
        contextKeys.set("explorerViewletCompressedFocus", compressed !== null);
        contextKeys.set("explorerViewletCompressedFirstFocus", compressed?.first ?? false);
        contextKeys.set("explorerViewletCompressedLastFocus", compressed?.last ?? false);
    }

    private containsFocus(active: TUIElement | null): boolean {
        if (this.parts === null) return false;
        for (let element = active; element !== null; element = element.getParent()) {
            if (element === this.parts.scrollBars) return true;
        }
        return false;
    }

    private rebuild(): void {
        const provider = this.explorerService.provider;
        /* v8 ignore start -- defensive: onDidChangeRoot only fires from setRootPath, where the provider is (re)created */
        if (!provider) return;
        /* v8 ignore stop */
        // Отступ в 1 колонку — внутри дерева, а не во внешнем паддинге: подсветка курсора заливает
        // строку от края панели. `workbench.tree.expandMode` (`expandOnlyOnTwistieClick` эталона)
        // читается на каждом жесте — правка settings.json действует сразу.
        const tree = new TreeViewElement<FileTreeNode>(provider, {
            leftPadding: 1,
            expandOnlyOnTwistieClick: () =>
                this.configurationService.get("workbench.tree.expandMode") === "doubleClick",
        });
        const scrollBars = new ScrollBarDecorator(tree);
        scrollBars.id = "explorerView";
        scrollBars.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.parts = { tree, scrollBars };

        tree.onExpandedChanged = (node, expanded) => {
            if (expanded) {
                provider.watchNode(node);
            } else {
                provider.unwatchNode(node);
            }
        };
        tree.onActivate = (node) => {
            if (!node.isDirectory) {
                // Превью просит только дерево: у эталона Quick Open и навигация по коду его не делают.
                this.commands.execute("workbench.openFile", node.path, { preview: true });
            }
        };
        tree.onContextMenu = (node, screenX, screenY) => {
            // Компактная строка: меню про папку текущего сегмента (дерево уже
            // сделало текущим сегмент под правым кликом).
            this.showContextMenu(tree, this.explorerService.nodePath(node), screenX, screenY);
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
        this.contextMenuService.showContextMenu({
            getOwner: () => tree,
            getAnchor: () => ({ screenX, screenY }),
            menuId: MenuId.ExplorerContext,
            menuContext: { path: filePath, canPaste: this.fileClipboard.read() !== null },
        });
    }
}
