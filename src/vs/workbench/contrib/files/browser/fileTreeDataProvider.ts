import * as path from "node:path";

import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import { Disposable, DisposableMap } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { FileType, type IFileService } from "../../../../platform/files/common/files.ts";
import type { ITreeFileWatcher } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { isExcludedPath } from "../../../common/configuration/excludeSettings.ts";

export interface FileTreeNode {
    name: string;
    path: string;
    isDirectory: boolean;
    isSymbolicLink?: boolean;
}

export class FileTreeDataProvider extends Disposable implements ITreeDataProvider<FileTreeNode> {
    private rootPath: string;
    /** Слежение за раскрытыми каталогами (по одному на каталог, без рекурсии). */
    private readonly watchers = this.register(new DisposableMap<string>());
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    // Статус-декорации по абсолютному пути (цвет имени + буква-бейдж). Ставит их
    // ExplorerService.setFileDecorations; git/RPC-логика живёт выше и цвета уже
    // приходят резолвнутыми.
    private gitStatus = new Map<string, { color?: number; badge?: string }>();

    public onChange?: (element?: FileTreeNode) => void;

    /**
     * @param excludes Шаблоны `files.exclude` (см. `excludeSettings.ts`).
     * Функция, а не список: настройка живая, и дерево после `refresh()` обязано
     * увидеть новый набор. Читать её на каждый `readdir` дешевле, чем кешировать
     * и подписываться — обход каталога и так идёт в ФС.
     * @param files Чтение каталогов — через файловый сервис.
     * @param treeWatcher Слежение за раскрытыми каталогами — общий наблюдатель
     * дерева (обход делится с git и LSP, ошибки ОС пишет он сам в `files.watcher`).
     */
    public constructor(
        rootPath: string,
        private readonly excludes: () => readonly string[],
        private readonly files: IFileService,
        private readonly treeWatcher: ITreeFileWatcher,
    ) {
        super();
        this.rootPath = rootPath;
    }

    public getTreeItem(element: FileTreeNode): ITreeItem {
        // Симлинк сохраняет обычную иконку типа (файл/каталог), а признак ссылки
        // помечается флагом symlink — стрелку рисует TreeViewElement у левого края,
        // не смещая иконки и не пряча их.
        const status = this.gitStatus.get(element.path);
        // Пробел справа — отступ буквы от края панели: TreeViewElement прижимает
        // бейдж вплотную к правому краю и rightPadding не имеет, поэтому отступ
        // живёт внутри строки бейджа (фон выделения при этом заливает край как обычно).
        const badge = status?.badge && `${status.badge} `;
        if (element.isDirectory) {
            return {
                label: element.name,
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

    /**
     * Заменяет карту статус-декораций (ключ — абсолютный путь). Цвета уже
     * резолвнуты в упакованный RGB; провайдер только раздаёт их через getTreeItem.
     */
    public setGitStatus(map: ReadonlyMap<string, { color?: number; badge?: string }>): void {
        this.gitStatus = new Map(map);
    }

    public getChildren(element?: FileTreeNode): Promise<FileTreeNode[]> {
        const dirPath = element ? element.path : this.rootPath;
        return this.readDirectory(dirPath);
    }

    public getKey(element: FileTreeNode): string {
        return element.path;
    }

    public watchDirectory(dirPath: string): void {
        if (this.watchers.has(dirPath)) return;
        // Только прямые дети: excludes наблюдателю не передаём (обходить нечего),
        // а скрытые настройкой входы отсекаем здесь — шаблоны `files.exclude`
        // считаются от корня дерева, а не от раскрытого каталога.
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

    /**
     * Скрыт ли вход настройкой. Шаблоны матчатся против пути ОТНОСИТЕЛЬНО корня
     * дерева в posix-форме — так же, как их матчат watcher и ripgrep, см.
     * {@link isExcludedPath}.
     */
    private isExcluded(absolutePath: string, excludes: readonly string[]): boolean {
        const relative = path.relative(this.rootPath, absolutePath).split(path.sep).join("/");
        return isExcludedPath(relative, excludes);
    }

    private async readDirectory(dirPath: string): Promise<FileTreeNode[]> {
        let children;
        try {
            children = (await this.files.resolve(Uri.file(dirPath))).children;
        } catch {
            return [];
        }

        const nodes: FileTreeNode[] = [];
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
                const node: FileTreeNode = {
                    name: path.basename(dirPath),
                    path: dirPath,
                    isDirectory: true,
                };
                this.onChange?.(node);
            }, 300),
        );
    }
}
