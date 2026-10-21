import * as path from "node:path";

import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import { Disposable, DisposableMap } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { FileType, type IFileService } from "../../../../platform/files/common/files.ts";
import type { ITreeFileWatcher } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { isExcludedPath } from "../../../common/configuration/excludeSettings.ts";

export interface FileTreeNode {
    /** Name of the last segment (for a compact node, of the chain's last folder). */
    name: string;
    /** For a compact node, the path of the chain's LAST folder: actions and decorations target it, as upstream. */
    path: string;
    isDirectory: boolean;
    isSymbolicLink?: boolean;
    /**
     * `explorer.compactFolders`: ancestor folders from the chain head to the parent of `path`. The head
     * is the node's key in the tree, so expansion survives both lengthening and breaking of the chain.
     */
    compactParents?: readonly string[];
}

function nodeKey(node: FileTreeNode): string {
    return node.compactParents?.[0] ?? node.path;
}

export function nodeSegments(node: FileTreeNode): readonly string[] {
    return node.compactParents ? [...node.compactParents, node.path] : [node.path];
}

function applyChain(node: FileTreeNode, segments: readonly string[]): void {
    const last = segments[segments.length - 1];
    node.path = last;
    node.name = path.basename(last);
    if (segments.length > 1) {
        node.compactParents = segments.slice(0, -1);
    } else {
        delete node.compactParents;
    }
}

interface IDirectoryEntry {
    readonly name: string;
    readonly path: string;
    readonly isDirectory: boolean;
    readonly isSymbolicLink: boolean;
}

export class FileTreeDataProvider extends Disposable implements ITreeDataProvider<FileTreeNode> {
    public readonly rootPath: string;
    private readonly watchers = this.register(new DisposableMap<string>());
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private gitStatus = new Map<string, { color?: number; badge?: string }>();
    /** Chains by head. Discovered lazily, like upstream: when the head is expanded, not by peeking into every directory ahead. */
    private readonly chains = new Map<string, readonly string[]>();
    private readonly chainOf = new Map<string, readonly string[]>();
    /**
     * The tree row is held by exactly this object: a chain found on expansion is written into it,
     * and the change notification carries the same object.
     */
    private readonly directoryNodes = new Map<string, FileTreeNode>();
    private readonly watchedChains = new Map<string, readonly string[]>();

    public onChange?: (element?: FileTreeNode) => void;

    /**
     * @param excludes A function, not a list: the setting is live and the tree must see the new set
     * after `refresh()`; reading it on every `readdir` is cheaper than caching and subscribing.
     */
    public constructor(
        rootPath: string,
        private readonly excludes: () => readonly string[],
        private readonly files: IFileService,
        private readonly treeWatcher: ITreeFileWatcher,
        private readonly compactFolders: () => boolean,
    ) {
        super();
        this.rootPath = rootPath;
    }

    public getTreeItem(element: FileTreeNode): ITreeItem {
        // A symlink gets the regular type icon plus the symlink flag: TreeViewElement draws the arrow at the edge.
        const status = this.gitStatus.get(element.path);
        // The space keeps the letter off the edge: TreeViewElement pins the badge flush and has no rightPadding.
        const badge = status?.badge && `${status.badge} `;
        if (element.isDirectory) {
            // The tree picks the current segment (Left/Right, click), as upstream.
            const segments = element.compactParents
                ? nodeSegments(element).map((segment) => path.basename(segment))
                : undefined;
            return {
                label: segments?.join("/") ?? element.name,
                labelSegments: segments,
                collapsible: true,
                symlink: element.isSymbolicLink,
                labelColor: status?.color,
                badge,
            };
        }
        const fileIcon = getFileIcon(element.name);
        return {
            label: element.name,
            icon: fileIcon.icon,
            iconColor: fileIcon.color,
            collapsible: false,
            symlink: element.isSymbolicLink,
            labelColor: status?.color,
            badge,
        };
    }

    /** The key is an absolute path; colors are already resolved to packed RGB. */
    public setGitStatus(map: ReadonlyMap<string, { color?: number; badge?: string }>): void {
        this.gitStatus = new Map(map);
    }

    public async getChildren(element?: FileTreeNode): Promise<FileTreeNode[]> {
        if (!element) return this.toNodes(await this.readDirectory(this.rootPath));
        // Walk the chain again from the head while a folder's only child is a directory: so it both
        // grows and breaks according to the FS. Don't descend into symlinks: a link to an ancestor would loop.
        const head = nodeKey(element);
        const segments = [head];
        let entries = await this.readDirectory(head);
        while (this.compactFolders() && entries.length === 1 && entries[0].isDirectory && !entries[0].isSymbolicLink) {
            segments.push(entries[0].path);
            entries = await this.readDirectory(entries[0].path);
        }
        this.setChain(segments);
        applyChain(element, segments);
        // While the descent waited on the FS, the parent may have been reread: the row is held by a new
        // object without a chain — without this the row draws uncompacted and reveal stalls on the head.
        // The same object is a no-op.
        const listed = this.directoryNodes.get(head);
        if (listed) applyChain(listed, segments);
        this.syncWatch(head, segments);
        return this.toNodes(entries);
    }

    public getKey(element: FileTreeNode): string {
        return nodeKey(element);
    }

    /** The very object the tree holds (a directory or a folder of its chain): reveal expands exactly it. */
    public findNode(dirPath: string): FileTreeNode | undefined {
        return this.directoryNodes.get(this.keyForPath(dirPath));
    }

    /** Key of the tree row that shows the path (a chain folder → its head). */
    public keyForPath(filePath: string): string {
        return this.chainOf.get(filePath)?.[0] ?? filePath;
    }

    /** After `explorer.compactFolders` or `files.exclude` (which decides whether a child is the only one) changes, chains are found anew. */
    public resetCompactFolders(): void {
        this.chains.clear();
        this.chainOf.clear();
    }

    public watchNode(node: FileTreeNode): void {
        const segments = nodeSegments(node);
        this.watchedChains.set(nodeKey(node), segments);
        for (const segment of segments) this.watchDirectory(segment);
    }

    public unwatchNode(node: FileTreeNode): void {
        const key = nodeKey(node);
        const segments = this.watchedChains.get(key) ?? nodeSegments(node);
        this.watchedChains.delete(key);
        for (const segment of segments) this.unwatchDirectory(segment);
    }

    public watchDirectory(dirPath: string): void {
        if (this.watchers.has(dirPath)) return;
        // Excludes aren't passed to the watcher: `files.exclude` patterns are relative to the tree root,
        // not the expanded directory — filter here.
        const watch = this.treeWatcher.watchTree(dirPath, { recursive: false, excludes: [] }, (changes) => {
            const excludes = this.excludes();
            if (changes.every((change) => this.isExcluded(change.path, excludes))) return;
            this.debouncedNotify(dirPath);
        });
        this.watchers.set(dirPath, watch);
    }

    public unwatchDirectory(dirPath: string): void {
        this.watchers.deleteAndDispose(dirPath);

        const timer = this.debounceTimers.get(dirPath);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(dirPath);
        }
    }

    public override dispose(): void {
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        super.dispose();
    }

    /** Patterns match the posix path relative to the tree root — like the watcher and ripgrep. */
    private isExcluded(absolutePath: string, excludes: readonly string[]): boolean {
        const relative = path.relative(this.rootPath, absolutePath).split(path.sep).join("/");
        return isExcludedPath(relative, excludes);
    }

    /** Listing nodes: a directory with an already known chain shows compact right away. */
    private toNodes(entries: readonly IDirectoryEntry[]): FileTreeNode[] {
        return entries.map((entry) => {
            const node: FileTreeNode = { ...entry };
            if (!entry.isDirectory) return node;
            const chain = this.chains.get(entry.path);
            if (chain) applyChain(node, chain);
            this.directoryNodes.set(entry.path, node);
            return node;
        });
    }

    private setChain(segments: readonly string[]): void {
        this.deleteChain(segments[0]);
        // Stryker disable next-line ConditionalExpression: a one-folder chain behaves like no chain (node without compactParents, key is the path itself); not stored, to avoid an entry per expanded directory
        if (segments.length < 2) return;
        this.chains.set(segments[0], segments);
        for (const segment of segments) this.chainOf.set(segment, segments);
    }

    private deleteChain(head: string): void {
        const chain = this.chains.get(head);
        if (!chain) return;
        this.chains.delete(head);
        for (const segment of chain) this.chainOf.delete(segment);
    }

    private syncWatch(key: string, segments: readonly string[]): void {
        const previous = this.watchedChains.get(key);
        if (!previous) return;
        for (const segment of previous) {
            if (!segments.includes(segment)) this.unwatchDirectory(segment);
        }
        for (const segment of segments) this.watchDirectory(segment);
        this.watchedChains.set(key, segments);
    }

    private async readDirectory(dirPath: string): Promise<IDirectoryEntry[]> {
        let children;
        try {
            children = (await this.files.resolve(Uri.file(dirPath))).children;
        } catch {
            return [];
        }

        const nodes: IDirectoryEntry[] = [];
        const excludes = this.excludes();
        for (const child of children) {
            const fullPath = path.join(dirPath, child.name);
            if (this.isExcluded(fullPath, excludes)) continue;
            // A symlink's type is already its target's (the provider resolved the link): a symlink to
            // a directory expands, a broken link shows as a file.
            nodes.push({
                name: child.name,
                path: fullPath,
                isDirectory: (child.type & FileType.Directory) !== 0,
                isSymbolicLink: (child.type & FileType.SymbolicLink) !== 0,
            });
        }

        nodes.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        return nodes;
    }

    private debouncedNotify(dirPath: string): void {
        const existing = this.debounceTimers.get(dirPath);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(
            dirPath,
            setTimeout(() => {
                this.debounceTimers.delete(dirPath);
                this.notifyChanged(dirPath);
            }, 300),
        );
    }

    /**
     * The chain's last folder holds the compact node's children: reread that node. An intermediate one
     * may have gained a second child and broken the chain: forget it and reread the head's parent.
     */
    private notifyChanged(dirPath: string): void {
        const chain = this.chainOf.get(dirPath);
        if (!chain || chain[chain.length - 1] === dirPath) {
            this.onChange?.(
                this.findNode(dirPath) ?? { name: path.basename(dirPath), path: dirPath, isDirectory: true },
            );
            return;
        }
        this.deleteChain(chain[0]);
        // The tail below is still a chain; the split-off row doesn't inherit expansion — its key is now its own head.
        this.setChain(chain.slice(chain.indexOf(dirPath) + 1));
        // A head at the root has no root node; `undefined` rereads the whole tree.
        this.onChange?.(this.findNode(path.dirname(chain[0])));
    }
}
