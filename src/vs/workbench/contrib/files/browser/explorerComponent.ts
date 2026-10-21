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

/** No folder is open (the editor was started on a file or without arguments). Upstream's text. */
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
 * Hands ViewsService only the section body ({@link ViewsService.setViewBody}), so a root change
 * doesn't recreate the viewlet or break the reference the sidebar holds.
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
        // Until a folder is open, the section draws a welcome, like VS Code's `viewsWelcome`; there is
        // no Clone Repository button since there is no clone command.
        viewsService.registerContainer({
            id: EXPLORER_VIEWLET_ID,
            title: "EXPLORER",
            // Stryker disable next-line StringLiteral: ViewsService only distinguishes "panel"; any other value (a mutated one included) goes to the sidebar, so replacing the string has no observable effect
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

    /** There is no tree until the first setRootPath. */
    public get view(): TUIElement {
        return this.parts?.scrollBars as TUIElement;
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("filesExplorerFocus", this.containsFocus(active));
        // Upstream's keys for the compact row under the cursor (`explorerView.onFocusChanged`
        // + `updateCompressedNavigationContextKeys`): they gate Left/Right/Home/End.
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
        // The 1-column indent is inside the tree, not outer padding: the cursor highlight fills the
        // row from the panel edge. `workbench.tree.expandMode` (upstream's `expandOnlyOnTwistieClick`)
        // is read on every gesture — a settings.json edit takes effect at once.
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
                // Only the tree asks for preview: upstream's Quick Open and code navigation don't.
                this.commands.execute("workbench.openFile", node.path, { preview: true });
            }
        };
        tree.onContextMenu = (node, screenX, screenY) => {
            // Compact row: the menu is for the current segment's folder (the tree has already
            // made the right-clicked segment current).
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
