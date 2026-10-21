import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IFileClipboard } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import { FileClipboardDIToken } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { ITreeFileWatcher } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { ITreeFileWatcherDIToken } from "../../../../platform/files/common/iTreeFileWatcherDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { FILES_EXCLUDE_SETTING, filesExcludeGlobs } from "../../../common/configuration/excludeSettings.ts";

import { bubbleFileDecorations, type IFileDecorationEntry } from "./bubbleFileDecorations.ts";
import { FileTreeDataProvider, type FileTreeNode, nodeSegments } from "./fileTreeDataProvider.ts";

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
    ] as const;

    public provider: FileTreeDataProvider | null = null;

    private rootPath: string | null = null;
    private view: IExplorerView | null = null;
    private readonly onDidChangeRootEmitter = this.register(new Emitter<void>());
    private readonly configurationService: IConfigurationService;
    /** The last decoration set from extensions — rebuilt when `explorer.decorations.*` changes. */
    // Stryker disable next-line ArrayDeclaration: junk in the initial set without path and propagate yields an undefined key that no tree row has
    private fileDecorations: readonly IFileDecorationEntry[] = [];

    public constructor(
        fileClipboard: IFileClipboard,
        configurationService: IConfigurationService,
        private readonly files: IFileService,
        private readonly treeWatcher: ITreeFileWatcher,
    ) {
        super();
        this.configurationService = configurationService;
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
                    this.applyFileDecorations();
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
        this.provider = this.register(
            new FileTreeDataProvider(
                rootPath,
                () => filesExcludeGlobs(this.configurationService),
                this.files,
                this.treeWatcher,
                () => this.configurationService.get(COMPACT_FOLDERS_SETTING),
            ),
        );
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

    /** Decorations with `propagate` bubble up to folders; colors are already resolved; an empty list clears all. */
    public setFileDecorations(entries: readonly IFileDecorationEntry[]): void {
        this.fileDecorations = entries;
        this.applyFileDecorations();
    }

    /** `explorer.decorations.colors`/`badges` turn off color and badge on all rows, as upstream does. */
    private applyFileDecorations(): void {
        if (!this.provider || !this.view) return;
        const colors = this.configurationService.get(DECORATION_COLORS_SETTING);
        const badges = this.configurationService.get(DECORATION_BADGES_SETTING);
        const decorations = bubbleFileDecorations(this.fileDecorations, this.provider.rootPath);
        const map = new Map<string, { color?: number; badge?: string }>();
        for (const [filePath, { color, badge }] of decorations) {
            map.set(filePath, { color: colors ? color : undefined, badge: badges ? badge : undefined });
        }
        this.provider.setGitStatus(map);
        void this.view.refresh();
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
