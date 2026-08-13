import * as fs from "node:fs";
import * as path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import { Disposable } from "@tuidom/all/common/disposable";
import type { ITreeDataProvider, ITreeItem } from "@tuidom/all/ui/tree/iTreeDataProvider";
import { getFileIcon } from "../../../../base/common/fileIcons.ts";

const EXCLUDED_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);

export interface FileTreeNode {
    name: string;
    path: string;
    isDirectory: boolean;
    isSymbolicLink?: boolean;
}

export class FileTreeDataProvider extends Disposable implements ITreeDataProvider<FileTreeNode> {
    private rootPath: string;
    private watchers = new Map<string, FSWatcher>();
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    // Статус-декорации по абсолютному пути (цвет имени + буква-бейдж). Ставит их
    // ExplorerService.setFileDecorations; git/RPC-логика живёт выше и цвета уже
    // приходят резолвнутыми.
    private gitStatus = new Map<string, { color?: number; badge?: string }>();

    public onChange?: (element?: FileTreeNode) => void;

    // Ошибка файлового watcher'а (например ENOSPC — исчерпан лимит inotify-watch'ей).
    // Провайдер сам её не логирует и не показывает — он лишь отдаёт наверх, где есть
    // логгер/UI. Наличие обработчика важно и функционально: без слушателя 'error'
    // EventEmitter chokidar'а бросает исключение из своих async-потрохов, которое
    // всплывает как unhandledRejection и убивает процесс.
    public onWatchError?: (dirPath: string, error: Error) => void;

    public constructor(rootPath: string) {
        super();
        this.rootPath = rootPath;
    }

    public getTreeItem(element: FileTreeNode): ITreeItem {
        // Симлинк сохраняет обычную иконку типа (файл/каталог), а признак ссылки
        // помечается флагом symlink — стрелку рисует TreeViewElement у левого края,
        // не смещая иконки и не пряча их.
        const status = this.gitStatus.get(element.path);
        if (element.isDirectory) {
            return {
                label: element.name,
                collapsible: true,
                symlink: element.isSymbolicLink,
                labelColor: status?.color,
                badge: status?.badge,
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
            badge: status?.badge,
        };
    }

    /**
     * Заменяет карту статус-декораций (ключ — абсолютный путь). Цвета уже
     * резолвнуты в упакованный RGB; провайдер только раздаёт их через getTreeItem.
     */
    public setGitStatus(map: ReadonlyMap<string, { color?: number; badge?: string }>): void {
        this.gitStatus = new Map(map);
    }

    public getChildren(element?: FileTreeNode): FileTreeNode[] {
        const dirPath = element ? element.path : this.rootPath;
        return this.readDirectory(dirPath);
    }

    public getKey(element: FileTreeNode): string {
        return element.path;
    }

    public watchDirectory(dirPath: string): void {
        if (this.watchers.has(dirPath)) return;

        const watcher = chokidar.watch(dirPath, {
            depth: 0,
            ignoreInitial: true,
            ignored: (filePath: string) => {
                const name = path.basename(filePath);
                return EXCLUDED_NAMES.has(name);
            },
        });

        watcher.on("all", () => {
            this.debouncedNotify(dirPath);
        });

        watcher.on("error", (err) => {
            // Роняем неудавшийся watcher, чтобы повторное раскрытие папки могло
            // попробовать снова (лимит мог освободиться), и сообщаем наверх.
            void watcher.close();
            this.watchers.delete(dirPath);
            this.onWatchError?.(dirPath, err as Error);
        });

        this.watchers.set(dirPath, watcher);
    }

    public unwatchDirectory(dirPath: string): void {
        const watcher = this.watchers.get(dirPath);
        if (!watcher) return;

        void watcher.close();
        this.watchers.delete(dirPath);

        const timer = this.debounceTimers.get(dirPath);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(dirPath);
        }
    }

    public override dispose(): void {
        for (const watcher of this.watchers.values()) {
            void watcher.close();
        }
        this.watchers.clear();
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        super.dispose();
    }

    private readDirectory(dirPath: string): FileTreeNode[] {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch {
            return [];
        }

        const nodes: FileTreeNode[] = [];
        for (const entry of entries) {
            if (EXCLUDED_NAMES.has(entry.name)) continue;
            const fullPath = path.join(dirPath, entry.name);
            const isSymbolicLink = entry.isSymbolicLink();
            let isDirectory = entry.isDirectory();
            if (isSymbolicLink) {
                // Dirent сообщает тип самой ссылки, а не цели. Резолвим цель, чтобы
                // симлинк на каталог был раскрываемым. Битую ссылку показываем как файл.
                try {
                    isDirectory = fs.statSync(fullPath).isDirectory();
                } catch {
                    isDirectory = false;
                }
            }
            nodes.push({
                name: entry.name,
                path: fullPath,
                isDirectory,
                isSymbolicLink,
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
