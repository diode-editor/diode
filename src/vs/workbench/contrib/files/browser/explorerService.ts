import * as path from "node:path";

import { Disposable } from "../../../../../../tuidom/common/disposable.ts";
import type { IFileClipboard } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { describeFileWatchError } from "../../../../platform/files/common/fileWatchErrors.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import { FileClipboardDIToken } from "../../../common/coreTokens.ts";

import { FileTreeDataProvider, type FileTreeNode } from "./fileTreeDataProvider.ts";

export const ExplorerServiceDIToken = token<ExplorerService>("ExplorerService");

/**
 * Минимальный срез дерева Explorer'а, нужный сервису: refresh/reveal/фокус,
 * выбор и подсветка «вырезанных». `TreeViewElement<FileTreeNode>` соответствует
 * ему структурно; регистрирует его `ExplorerComponent` через {@link ExplorerService.attachView}
 * (сервис про конкретные контролы/компоненты не знает).
 */
export interface IExplorerView {
    refresh(): Promise<void>;
    reveal(chain: FileTreeNode[]): Promise<void>;
    focus(): void;
    getSelectedNode(): FileTreeNode | null;
    getSelectedNodes(): FileTreeNode[];
    setCutKeys(keys: Set<string>): void;
    clearCutKeys(): void;
}

/**
 * Сервис Explorer'а (аналог `IExplorerService` VS Code): корень воркспейса,
 * провайдер данных дерева ({@link FileTreeDataProvider}), reveal/refresh,
 * выбор, статус-декорации файлов и подсветка «вырезанных» (следует за
 * {@link IFileClipboard}). View приходит через шов {@link IExplorerView} —
 * без него операции над деревом деградируют в no-op.
 */
export class ExplorerService extends Disposable {
    public static dependencies = [FileClipboardDIToken, IConfigurationServiceDIToken, ILogServiceDIToken] as const;

    /** Активный провайдер дерева (создаётся в {@link setRootPath}); читает его компонент. */
    public provider: FileTreeDataProvider | null = null;

    private rootPath: string | null = null;
    private view: IExplorerView | null = null;
    private rootListeners = new Set<() => void>();
    private readonly configurationService: IConfigurationService;
    private readonly watcherLogger: ILogger;

    public constructor(
        fileClipboard: IFileClipboard,
        configurationService: IConfigurationService,
        logService: ILogService,
    ) {
        super();
        this.configurationService = configurationService;
        this.watcherLogger = logService.createLogger("filetree.watcher");
        // Подсветка «вырезанных» файлов в дереве следует за состоянием буфера.
        this.register(
            fileClipboard.onDidChange((entry) => {
                this.setCutPaths(entry?.mode === "cut" ? entry.paths : []);
            }),
        );
    }

    /** Смена корня перестраивает провайдер и оповещает подписчиков (компонент строит новое дерево). */
    public onDidChangeRoot(listener: () => void): { dispose(): void } {
        this.rootListeners.add(listener);
        return { dispose: () => this.rootListeners.delete(listener) };
    }

    public setRootPath(rootPath: string): void {
        this.rootPath = rootPath;
        this.provider = this.register(new FileTreeDataProvider(rootPath));
        // Ошибка файлового watcher'а не роняет процесс (см. FileTreeDataProvider):
        // ловим её здесь и пишем в лог. ENOSPC/EMFILE — исчерпан лимит inotify; даём
        // самодокументирующуюся подсказку, как в уведомлении VS Code.
        this.provider.onWatchError = (dirPath, error) => {
            const { code, hint } = describeFileWatchError(error);
            this.watcherLogger.warn(`file watcher error${hint}`, { dirPath, code, error: String(error) });
        };
        for (const listener of [...this.rootListeners]) listener();
    }

    public getRootPath(): string | null {
        return this.rootPath;
    }

    public hasRootPath(): boolean {
        return this.rootPath !== null;
    }

    /** Регистрация дерева компонентом (null — отцепить). */
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

    /**
     * Раскрывает дерево до файла `filePath` и выделяет его. Путь вне корня игнорируется.
     * Возвращает `true`, если файл лежит внутри корня (и попытка раскрытия выполнена).
     */
    public async revealPath(filePath: string): Promise<boolean> {
        if (!this.view || this.rootPath === null) return false;
        const relative = path.relative(this.rootPath, filePath);
        /* v8 ignore next -- isAbsolute(relative) is Windows-only (cross-drive paths); unreachable on POSIX CI */
        if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
            return false;
        }
        const segments = relative.split(path.sep);
        const chain: FileTreeNode[] = [];
        let current = this.rootPath;
        for (let i = 0; i < segments.length; i++) {
            current = path.join(current, segments[i]);
            const isLast = i === segments.length - 1;
            chain.push({ name: segments[i], path: current, isDirectory: !isLast });
        }
        await this.view.reveal(chain);
        return true;
    }

    /**
     * Автоматически подсвечивает активный файл в дереве при смене активного редактора,
     * если включена настройка `explorer.autoReveal`. Фокус не отбирается у редактора —
     * меняется только выделение/скролл дерева (в отличие от явной команды reveal).
     */
    public autoRevealActiveFile(filePath: string | null): void {
        const autoReveal = this.configurationService.get<boolean>("explorer.autoReveal", true) ?? true;
        if (!autoReveal) return;
        if (!filePath) return;
        void this.revealPath(filePath);
    }

    /** Пути выбранных узлов (множественный выбор либо узел под курсором). */
    public getSelectedPaths(): string[] {
        return this.view?.getSelectedNodes().map((node) => node.path) ?? [];
    }

    /** Путь выбранного ФАЙЛА под курсором; каталог или пустое дерево — `null` (Open to the Side). */
    public getSelectedFilePath(): string | null {
        const node = this.view?.getSelectedNode() ?? null;
        return node !== null && !node.isDirectory ? node.path : null;
    }

    /**
     * Каталог, в который должна выполняться вставка: сам узел под курсором, если это
     * папка, иначе — его родитель. При пустом дереве — корень.
     */
    public getPasteTargetDir(): string | null {
        const node = this.view?.getSelectedNode() ?? null;
        if (!node) return this.rootPath;
        return node.isDirectory ? node.path : path.dirname(node.path);
    }

    /**
     * Проставляет статус-декорации файлов (цвет имени + буква-бейдж) по абсолютному
     * пути и перерисовывает дерево. Цвета приходят уже резолвнутыми — тема тут
     * ни при чём. Пустой список снимает все декорации.
     */
    public setFileDecorations(entries: readonly { path: string; color?: number; badge?: string }[]): void {
        if (!this.provider || !this.view) return;
        const map = new Map<string, { color?: number; badge?: string }>();
        for (const entry of entries) {
            map.set(entry.path, { color: entry.color, badge: entry.badge });
        }
        this.provider.setGitStatus(map);
        void this.view.refresh();
    }

    /** Подсвечивает «вырезанные» пути приглушённым цветом (или снимает подсветку). */
    private setCutPaths(paths: string[]): void {
        if (!this.view) return;
        if (paths.length === 0) {
            this.view.clearCutKeys();
        } else {
            this.view.setCutKeys(new Set(paths));
        }
    }
}
