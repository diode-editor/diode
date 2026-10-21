import * as path from "node:path";

import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import { Disposable, DisposableMap } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { FileType, type IFileService } from "../../../../platform/files/common/files.ts";
import type { ITreeFileWatcher } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { isExcludedPath } from "../../../common/configuration/excludeSettings.ts";

export interface FileTreeNode {
    /** Имя последнего сегмента (у компактного узла — последней папки цепочки). */
    name: string;
    /** У компактного узла — путь ПОСЛЕДНЕЙ папки цепочки: на неё смотрят действия и декорации, как у эталона. */
    path: string;
    isDirectory: boolean;
    isSymbolicLink?: boolean;
    /**
     * `explorer.compactFolders`: папки-предки от головы цепочки до родителя `path`. Голова — ключ
     * узла в дереве, поэтому раскрытие переживает и удлинение, и разрыв цепочки.
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
    /** Цепочки по голове. Узнаём лениво, как эталон: при раскрытии головы, а не заглядывая заранее в каждый каталог. */
    private readonly chains = new Map<string, readonly string[]>();
    private readonly chainOf = new Map<string, readonly string[]>();
    /**
     * Строку дерева держит именно этот объект: найденная при раскрытии цепочка пишется в него,
     * и уведомление об изменении уходит с ним же.
     */
    private readonly directoryNodes = new Map<string, FileTreeNode>();
    private readonly watchedChains = new Map<string, readonly string[]>();

    public onChange?: (element?: FileTreeNode) => void;

    /**
     * @param excludes Функция, а не список: настройка живая, и дерево после `refresh()` обязано
     * увидеть новый набор; читать её на каждый `readdir` дешевле, чем кешировать и подписываться.
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
        // Симлинк — обычная иконка типа плюс флаг symlink: стрелку рисует TreeViewElement у края.
        const status = this.gitStatus.get(element.path);
        // Пробел — отступ буквы от края: TreeViewElement прижимает бейдж вплотную и rightPadding не имеет.
        const badge = status?.badge && `${status.badge} `;
        if (element.isDirectory) {
            // Текущий сегмент выбирает дерево (Left/Right, клик), как у эталона.
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

    /** Ключ — абсолютный путь; цвета уже резолвнуты в упакованный RGB. */
    public setGitStatus(map: ReadonlyMap<string, { color?: number; badge?: string }>): void {
        this.gitStatus = new Map(map);
    }

    public async getChildren(element?: FileTreeNode): Promise<FileTreeNode[]> {
        if (!element) return this.toNodes(await this.readDirectory(this.rootPath));
        // Цепочку проходим заново от головы, пока у папки единственный ребёнок — каталог: так она
        // и растёт, и рвётся по факту ФС. В симлинк не спускаемся: ссылка на предка зациклила бы спуск.
        const head = nodeKey(element);
        const segments = [head];
        let entries = await this.readDirectory(head);
        while (this.compactFolders() && entries.length === 1 && entries[0].isDirectory && !entries[0].isSymbolicLink) {
            segments.push(entries[0].path);
            entries = await this.readDirectory(entries[0].path);
        }
        this.setChain(segments);
        applyChain(element, segments);
        // Пока спуск ждал ФС, родителя могли перечитать: строку держит новый объект без цепочки —
        // без этого строка рисуется несжатой, а reveal топчется на голове. Тот же объект — no-op.
        const listed = this.directoryNodes.get(head);
        if (listed) applyChain(listed, segments);
        this.syncWatch(head, segments);
        return this.toNodes(entries);
    }

    public getKey(element: FileTreeNode): string {
        return nodeKey(element);
    }

    /** Тот самый объект, что держит дерево (каталог или папка его цепочки): reveal раскрывает именно его. */
    public findNode(dirPath: string): FileTreeNode | undefined {
        return this.directoryNodes.get(this.keyForPath(dirPath));
    }

    /** Ключ строки дерева, которая показывает путь (папка цепочки → её голова). */
    public keyForPath(filePath: string): string {
        return this.chainOf.get(filePath)?.[0] ?? filePath;
    }

    /** После смены `explorer.compactFolders` или `files.exclude` (решает, единственный ли ребёнок) цепочки ищут заново. */
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
        // excludes наблюдателю не передаём: шаблоны `files.exclude` считаются от корня дерева,
        // а не от раскрытого каталога, — отсекаем здесь.
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

    /** Шаблоны матчатся против posix-пути относительно корня дерева — как у watcher и ripgrep. */
    private isExcluded(absolutePath: string, excludes: readonly string[]): boolean {
        const relative = path.relative(this.rootPath, absolutePath).split(path.sep).join("/");
        return isExcludedPath(relative, excludes);
    }

    /** Узлы листинга: каталог с уже известной цепочкой сразу показывается компактным. */
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
        // Stryker disable next-line ConditionalExpression: цепочка из одной папки ведёт себя как её отсутствие (узел без compactParents, ключ — сам путь); не храним её, чтобы не держать запись на каждый раскрытый каталог
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
            // Тип симлинка — уже тип цели (провайдер разрешил ссылку): симлинк на
            // каталог раскрывается, битая ссылка показывается файлом.
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
     * Последняя папка цепочки — это дети компактного узла: перечитываем его. Промежуточная могла
     * получить второго ребёнка и порвать цепочку: забываем её и перечитываем родителя головы.
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
        // Хвост ниже по-прежнему цепочка; отделившаяся строка раскрытие не наследует — её ключ теперь своя голова.
        this.setChain(chain.slice(chain.indexOf(dirPath) + 1));
        // Голова в корне — узла у корня нет, `undefined` перечитывает всё дерево.
        this.onChange?.(this.findNode(path.dirname(chain[0])));
    }
}
