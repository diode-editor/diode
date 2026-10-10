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

import { FileTreeDataProvider, type FileTreeNode, nodeSegments } from "./fileTreeDataProvider.ts";

export const ExplorerServiceDIToken = token<ExplorerService>("ExplorerService");

const COMPACT_FOLDERS_SETTING = "explorer.compactFolders";

/**
 * Цепочка строк дерева от корня до `filePath`. Предков раскрываем по ходу:
 * компактную цепочку (`explorer.compactFolders`) провайдер узнаёт, только
 * когда её голову раскрыли, а она решает, какая строка следующая.
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
        chain.push(node);
        await view.expand(node);
        // После раскрытия `node.path` — последняя папка его цепочки. Цель не
        // под ней — значит, цель и есть эта строка: сама последняя папка или
        // промежуточная, свёрнутая в строку (эталон выделяет компактный узел и
        // ставит «текущим» её сегмент; сегменты по отдельности мы не выделяем).
        // Так же — устаревшая цепочка (вход появился в промежуточной папке, а
        // наблюдатель ещё не дошёл): выделяем ближайшую строку, что его содержит.
        if (!filePath.startsWith(node.path + path.sep)) return chain;
        dir = node.path;
    }
}

/**
 * Минимальный срез дерева Explorer'а, нужный сервису: refresh/reveal/фокус,
 * выбор и подсветка «вырезанных». `TreeViewElement<FileTreeNode>` соответствует
 * ему структурно; регистрирует его `ExplorerComponent` через {@link ExplorerService.attachView}
 * (сервис про конкретные контролы/компоненты не знает).
 */
export interface IExplorerView {
    refresh(): Promise<void>;
    expand(element: FileTreeNode): Promise<void>;
    reveal(chain: FileTreeNode[]): Promise<void>;
    focus(): void;
    getSelectedNode(): FileTreeNode | null;
    getSelectedNodes(): FileTreeNode[];
    /** Текущий сегмент компактной строки узла (по умолчанию последний); у обычной — 0. */
    getSegmentIndex(element: FileTreeNode): number;
    focusPreviousSegment(): boolean;
    focusNextSegment(): boolean;
    focusFirstSegment(): boolean;
    focusLastSegment(): boolean;
    setCutKeys(keys: Set<string>): void;
    clearCutKeys(): void;
}

/**
 * Сервис Explorer'а (аналог `IExplorerService` VS Code): корень СВОЕГО дерева,
 * провайдер данных дерева ({@link FileTreeDataProvider}), reveal/refresh,
 * выбор, статус-декорации файлов и подсветка «вырезанных» (следует за
 * {@link IFileClipboard}). View приходит через шов {@link IExplorerView} —
 * без него операции над деревом деградируют в no-op.
 *
 * Источником правды о папках воркспейса этот сервис больше НЕ является: за
 * корнем ходят в `IWorkspaceContextService` (`platform/workspace/common`).
 * Здесь остался только корень дерева — он же приезжает от владельца папки
 * (`WorkbenchComponent.setWorkspaceFolder`) через {@link setRootPath}.
 */
export class ExplorerService extends Disposable {
    public static dependencies = [
        FileClipboardDIToken,
        IConfigurationServiceDIToken,
        IFileServiceDIToken,
        ITreeFileWatcherDIToken,
    ] as const;

    /** Активный провайдер дерева (создаётся в {@link setRootPath}); читает его компонент. */
    public provider: FileTreeDataProvider | null = null;

    private rootPath: string | null = null;
    private view: IExplorerView | null = null;
    private readonly onDidChangeRootEmitter = this.register(new Emitter<void>());
    private readonly configurationService: IConfigurationService;

    public constructor(
        fileClipboard: IFileClipboard,
        configurationService: IConfigurationService,
        private readonly files: IFileService,
        private readonly treeWatcher: ITreeFileWatcher,
    ) {
        super();
        this.configurationService = configurationService;
        // Подсветка «вырезанных» файлов в дереве следует за состоянием буфера.
        this.register(
            fileClipboard.onDidChange((entry) => {
                this.setCutPaths(entry?.mode === "cut" ? entry.paths : []);
            }),
        );
        // `files.exclude` живая: провайдер читает её на каждый readdir, но
        // перечитать дерево ему никто не скажет — говорим здесь. Сам набор
        // шаблонов в сравнении не участвует: дифф ключей уже посчитал
        // ConfigurationService, а лишний refresh дешевле пропущенного.
        // `explorer.compactFolders` — так же: найденные цепочки собираются
        // заново (от `files.exclude` зависит, единственный ли ребёнок у папки).
        this.register(
            configurationService.onDidChangeConfiguration((event) => {
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

    /** Смена корня перестраивает провайдер и оповещает подписчиков (компонент строит новое дерево). */
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
        // Провайдер есть ровно тогда, когда есть корень (оба ставит setRootPath).
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

    /**
     * Автоматически подсвечивает активный файл в дереве при смене активного редактора,
     * если включена настройка `explorer.autoReveal`. Фокус не отбирается у редактора —
     * меняется только выделение/скролл дерева (в отличие от явной команды reveal).
     */
    public autoRevealActiveFile(filePath: string | null): void {
        const autoReveal = this.configurationService.get("explorer.autoReveal");
        if (!autoReveal) return;
        if (!filePath) return;
        void this.revealPath(filePath);
    }

    /**
     * Путь, за который отвечает строка узла: у компактной строки — папка её
     * текущего сегмента (эталон: `CompressedNavigationController.current`), у
     * обычной — сам `node.path`.
     */
    public nodePath(node: FileTreeNode): string {
        if (!node.compactParents || !this.view) return node.path;
        return nodeSegments(node)[this.view.getSegmentIndex(node)] ?? node.path;
    }

    /**
     * Состояние текущего сегмента строки под курсором — для контекст-ключей
     * `explorerViewletCompressed*`; `null` — строка не компактная или дерева нет.
     */
    public getCompressedFocus(): { readonly first: boolean; readonly last: boolean } | null {
        const node = this.view?.getSelectedNode() ?? null;
        if (!node?.compactParents || !this.view) return null;
        const index = this.view.getSegmentIndex(node);
        return { first: index === 0, last: index === node.compactParents.length };
    }

    /** Команды `*CompressedFolder`: сдвиг текущего сегмента строки под курсором. */
    public moveCompressedFocus(target: "previous" | "next" | "first" | "last"): void {
        const view = this.view;
        if (!view) return;
        const moves = {
            previous: () => view.focusPreviousSegment(),
            next: () => view.focusNextSegment(),
            first: () => view.focusFirstSegment(),
            last: () => view.focusLastSegment(),
        };
        moves[target]();
    }

    /**
     * Пути выбранных узлов (множественный выбор либо узел под курсором). Строка
     * под курсором отдаёт текущий сегмент; прочие выбранные компактные строки —
     * последнюю папку (эталон в мультивыборе берёт все папки цепочки).
     */
    public getSelectedPaths(): string[] {
        const cursor = this.view?.getSelectedNode() ?? null;
        return this.view?.getSelectedNodes().map((node) => (node === cursor ? this.nodePath(node) : node.path)) ?? [];
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
        return node.isDirectory ? this.nodePath(node) : path.dirname(node.path);
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
            // Ключ строки — голова компактной цепочки, а путь узла — её последняя папка.
            const keys = paths.map((p) => this.provider?.keyForPath(p) ?? p);
            this.view.setCutKeys(new Set(keys));
        }
    }
}
