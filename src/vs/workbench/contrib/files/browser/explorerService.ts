import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, MutableDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IFileClipboard } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import { FileClipboardDIToken } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { ITreeFileWatcher } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { ITreeFileWatcherDIToken } from "../../../../platform/files/common/iTreeFileWatcherDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { IWorkbenchColors } from "../../../../platform/theme/common/colors/colorContributions.ts";
import { FILES_EXCLUDE_SETTING, filesExcludeGlobs } from "../../../common/configuration/excludeSettings.ts";
import {
    DecorationsServiceDIToken,
    type IDecorationsService,
    NULL_DECORATIONS_SERVICE,
} from "../../../services/decorations/common/decorations.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

import { FileTreeDataProvider, type FileTreeNode, type IRowDecoration, nodeSegments } from "./fileTreeDataProvider.ts";

export const ExplorerServiceDIToken = token<ExplorerService>("ExplorerService");

const COMPACT_FOLDERS_SETTING = "explorer.compactFolders";
const DECORATION_COLORS_SETTING = "explorer.decorations.colors";
const DECORATION_BADGES_SETTING = "explorer.decorations.badges";

/**
 * Ancestors are expanded along the way: the provider learns a compact chain only once its
 * head is expanded, and the chain decides which row comes next.
 */
async function revealChain(
    view: IExplorerView,
    provider: FileTreeDataProvider,
    filePath: string,
): Promise<FileTreeNode[]> {
    const chain: FileTreeNode[] = [];
    let dir = provider.rootPath;
    for (;;) {
        const name = path.relative(dir, filePath).split(path.sep)[0];
        const childPath = path.join(dir, name);
        if (childPath === filePath) {
            chain.push(provider.findNode(childPath) ?? { name, path: childPath, isDirectory: false });
            return chain;
        }
        const node = provider.findNode(childPath) ?? { name, path: childPath, isDirectory: true };
        // The same row as on the previous step (a chain folder the node doesn't
        // show — see below) isn't added to the chain twice.
        if (chain[chain.length - 1] !== node) {
            chain.push(node);
            await view.expand(node);
        }
        // The target isn't under the chain's last folder, so the target is this row (upstream selects
        // the compact node without touching the current segment). Same for a stale chain: nearest row.
        if (!filePath.startsWith(node.path + path.sep)) return chain;
        // Each step must go at least one segment deeper: `node.path` can stay above `childPath`
        // (the row's node has no chain yet, and `expand` of an expanded node is a no-op), and the
        // microtask loop hung the editor for good on a large monorepo.
        dir = node.path.startsWith(dir + path.sep) ? node.path : childPath;
    }
}

/** `TreeViewElement<FileTreeNode>` matches structurally; the service knows nothing about concrete controls. */
export interface IExplorerView {
    refresh(): Promise<void>;
    expand(element: FileTreeNode): Promise<void>;
    reveal(chain: FileTreeNode[]): Promise<void>;
    focus(): void;
    getSelectedNode(): FileTreeNode | null;
    getSelectedNodes(): FileTreeNode[];
    /** The current segment of the node's compact row (the last by default); 0 for a plain row. */
    getSegmentIndex(element: FileTreeNode): number;
    focusPreviousSegment(): boolean;
    focusNextSegment(): boolean;
    focusFirstSegment(): boolean;
    focusLastSegment(): boolean;
    setCutKeys(keys: Set<string>): void;
    clearCutKeys(): void;
}

/**
 * Counterpart of VS Code's `IExplorerService`. Without an {@link IExplorerView} tree operations are no-ops.
 * The source of truth for workspace folders is `IWorkspaceContextService`; this holds only the tree root.
 */
export class ExplorerService extends Disposable {
    public static dependencies = [
        FileClipboardDIToken,
        IConfigurationServiceDIToken,
        IFileServiceDIToken,
        ITreeFileWatcherDIToken,
        ProductIconServiceDIToken,
        DecorationsServiceDIToken,
        ThemeServiceDIToken,
    ] as const;

    public provider: FileTreeDataProvider | null = null;
    /** Owns the current provider: a new root disposes the old one with its watches (the root's included). */
    private readonly providerOwner = this.register(new MutableDisposable<FileTreeDataProvider>());

    private rootPath: string | null = null;
    private view: IExplorerView | null = null;
    private readonly onDidChangeRootEmitter = this.register(new Emitter<void>());
    private readonly configurationService: IConfigurationService;

    public constructor(
        fileClipboard: IFileClipboard,
        configurationService: IConfigurationService,
        private readonly files: IFileService,
        private readonly treeWatcher: ITreeFileWatcher,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
        private readonly decorations: IDecorationsService = NULL_DECORATIONS_SERVICE,
        /** Resolves the decorations' theme colors; without it the rows keep their own color. */
        private readonly themeService: ThemeService | null = null,
    ) {
        super();
        this.configurationService = configurationService;
        // The tree caches its rows' items until a refresh: a decoration that arrived or changed needs one. The
        // decorations themselves come from the service's cache, so a refresh asks no provider again.
        this.register(
            decorations.onDidChangeDecorations(() => {
                void this.refresh();
            }),
        );
        if (themeService !== null) {
            let seeded = false;
            this.register(
                themeService.onThemeChange(() => {
                    // The first call is the current theme, not a change.
                    if (seeded) void this.refresh();
                    seeded = true;
                }),
            );
        }
        this.register(
            icons.onDidChange(() => {
                void this.refresh();
            }),
        );
        this.register(
            fileClipboard.onDidChange((entry) => {
                this.setCutPaths(entry?.mode === "cut" ? entry.paths : []);
            }),
        );
        // `files.exclude` and `explorer.compactFolders` are live, but nobody else tells the provider to
        // reread the tree; the pattern set isn't compared — an extra refresh is cheaper than a missed one.
        this.register(
            configurationService.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration(DECORATION_COLORS_SETTING) ||
                    event.affectsConfiguration(DECORATION_BADGES_SETTING)
                ) {
                    void this.refresh();
                }
                if (
                    !event.affectsConfiguration(FILES_EXCLUDE_SETTING) &&
                    !event.affectsConfiguration(COMPACT_FOLDERS_SETTING)
                ) {
                    return;
                }
                this.provider?.resetCompactFolders();
                void this.refresh();
            }),
        );
    }

    public readonly onDidChangeRoot = this.onDidChangeRootEmitter.event;

    public setRootPath(rootPath: string): void {
        this.rootPath = rootPath;
        this.provider = new FileTreeDataProvider(
            rootPath,
            () => filesExcludeGlobs(this.configurationService),
            this.files,
            this.treeWatcher,
            () => this.configurationService.get(COMPACT_FOLDERS_SETTING),
            this.icons,
            (node) => this.decorationOf(node),
        );
        this.providerOwner.value = this.provider;
        this.onDidChangeRootEmitter.fire();
    }

    /** `null` detaches. */
    public attachView(view: IExplorerView | null): void {
        this.view = view;
    }

    public async refresh(): Promise<void> {
        if (this.view) {
            await this.view.refresh();
        }
    }

    public focus(): void {
        this.view?.focus();
    }

    /** A path outside the root is ignored; `true` means the file is inside the root. */
    public async revealPath(filePath: string): Promise<boolean> {
        // The provider exists exactly when the root does (setRootPath sets both).
        const provider = this.provider;
        if (!this.view || !provider) return false;
        const relative = path.relative(provider.rootPath, filePath);
        /* v8 ignore next -- isAbsolute(relative) is Windows-only (cross-drive paths); unreachable on POSIX CI */
        if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
            return false;
        }
        await this.view.reveal(await revealChain(this.view, provider, filePath));
        return true;
    }

    /** Doesn't take focus from the editor, unlike the explicit reveal command. */
    public autoRevealActiveFile(filePath: string | null): void {
        const autoReveal = this.configurationService.get("explorer.autoReveal");
        if (!autoReveal) return;
        if (!filePath) return;
        void this.revealPath(filePath);
    }

    /** For a compact row, the current segment's folder (upstream's `CompressedNavigationController.current`). */
    public nodePath(node: FileTreeNode): string {
        if (!node.compactParents || !this.view) return node.path;
        return nodeSegments(node)[this.view.getSegmentIndex(node)] ?? node.path;
    }

    /** For the `explorerViewletCompressed*` context keys; `null` if the row isn't compact or there is no tree. */
    public getCompressedFocus(): { readonly first: boolean; readonly last: boolean } | null {
        const node = this.view?.getSelectedNode() ?? null;
        if (!node?.compactParents || !this.view) return null;
        const index = this.view.getSegmentIndex(node);
        return { first: index === 0, last: index === node.compactParents.length };
    }

    public moveCompressedFocus(target: "previous" | "next" | "first" | "last"): void {
        switch (target) {
            case "previous":
                this.view?.focusPreviousSegment();
                break;
            case "next":
                this.view?.focusNextSegment();
                break;
            case "first":
                this.view?.focusFirstSegment();
                break;
            case "last":
                this.view?.focusLastSegment();
                break;
        }
    }

    /**
     * Like upstream's `getContext`: a single compact row yields its current segment's folder; in a
     * multi-selection, all folders of the chain (paste later collapses nested ones).
     */
    public getSelectedPaths(): string[] {
        const nodes = this.view?.getSelectedNodes() ?? [];
        if (nodes.length === 1) return [this.nodePath(nodes[0])];
        return nodes.flatMap((node) => nodeSegments(node));
    }

    /**
     * Targets of a context-menu action on the row at `rowPath` (upstream `getMultiSelectedResources`): the
     * whole selection when the row is part of it, else the row alone.
     */
    public getContextTargets(rowPath: string): string[] {
        const selected = this.getSelectedPaths();
        return selected.includes(rowPath) ? selected : [rowPath];
    }

    /**
     * Targets of an explorer command by its argument: the menu's list (`explorerTargetsArg`), an explicit
     * path (an editor tab, the command API) or, from a keybinding (no argument), the selection.
     */
    public getCommandTargets(arg: unknown): readonly string[] {
        if (typeof arg === "string") return [arg];
        return (arg as readonly string[] | undefined) ?? this.getSelectedPaths();
    }

    /** By the listed tree rows: a path the tree hasn't listed counts as a file. */
    public isDirectory(filePath: string): boolean {
        return this.provider?.findNode(filePath) !== undefined;
    }

    /** `null` for a directory or an empty tree. */
    public getSelectedFilePath(): string | null {
        const node = this.view?.getSelectedNode() ?? null;
        return node !== null && !node.isDirectory ? node.path : null;
    }

    public getPasteTargetDir(): string | null {
        const node = this.view?.getSelectedNode() ?? null;
        if (!node) return this.rootPath;
        return node.isDirectory ? this.nodePath(node) : path.dirname(node.path);
    }

    /**
     * Upstream's `ResourceLabel` with `fileDecorations`: a file asks for its own decoration, a folder for its
     * descendants' too. `explorer.decorations.colors`/`badges` turn off color and badge on all rows, as upstream.
     */
    private decorationOf(node: FileTreeNode): IRowDecoration | undefined {
        const decoration = this.decorations.getDecoration(Uri.file(node.path), node.isDirectory);
        if (decoration === undefined) return undefined;
        const color =
            decoration.color !== undefined && this.configurationService.get(DECORATION_COLORS_SETTING)
                ? this.themeService?.theme.getColor(decoration.color as keyof IWorkbenchColors)
                : undefined;
        const badge = this.configurationService.get(DECORATION_BADGES_SETTING) ? decoration.badge : undefined;
        return { color, badge };
    }

    private setCutPaths(paths: string[]): void {
        if (!this.view) return;
        if (paths.length === 0) {
            this.view.clearCutKeys();
        } else {
            // The row key is the compact chain's head, while the node path is its last folder.
            const keys = paths.map((p) => this.provider?.keyForPath(p) ?? p);
            this.view.setCutKeys(new Set(keys));
        }
    }
}
