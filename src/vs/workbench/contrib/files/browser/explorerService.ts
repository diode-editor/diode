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
 * Предков раскрываем по ходу: компактную цепочку провайдер узнаёт, только когда её
 * голову раскрыли, а она решает, какая строка следующая.
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
        // Та же строка, что на прошлом шаге (папка цепочки, которую узел не
        // показывает, — см. ниже), второй раз в цепочку не идёт.
        if (chain[chain.length - 1] !== node) {
            chain.push(node);
            await view.expand(node);
        }
        // Цель не под последней папкой цепочки — значит, цель и есть эта строка (эталон выделяет
        // компактный узел, текущий сегмент не трогая). Так же — устаревшая цепочка: ближайшая строка.
        if (!filePath.startsWith(node.path + path.sep)) return chain;
        // Каждый шаг обязан уйти хотя бы на сегмент глубже: `node.path` может остаться выше
        // `childPath` (узел строки цепочку ещё не получил, `expand` раскрытого — no-op), и цикл
        // на микротасках вешал редактор намертво на большом монорепо.
        dir = node.path.startsWith(dir + path.sep) ? node.path : childPath;
    }
}

/** `TreeViewElement<FileTreeNode>` соответствует структурно; сервис про конкретные контролы не знает. */
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
 * Аналог `IExplorerService` VS Code. Без {@link IExplorerView} операции над деревом — no-op.
 * Источник правды о папках воркспейса — `IWorkspaceContextService`, здесь только корень дерева.
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
    /** Последний набор декораций от расширений — пересобирается на смену `explorer.decorations.*`. */
    // Stryker disable next-line ArrayDeclaration: мусор в начальном наборе без path и propagate даёт ключ-undefined, которого нет ни у одной строки дерева
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
        // `files.exclude` и `explorer.compactFolders` живые, но перечитать дерево провайдеру никто
        // не скажет; набор шаблонов не сравниваем — лишний refresh дешевле пропущенного.
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

    /** `null` — отцепить. */
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

    /** Путь вне корня игнорируется; `true` — файл внутри корня. */
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

    /** Фокус у редактора не отбирается — в отличие от явной команды reveal. */
    public autoRevealActiveFile(filePath: string | null): void {
        const autoReveal = this.configurationService.get("explorer.autoReveal");
        if (!autoReveal) return;
        if (!filePath) return;
        void this.revealPath(filePath);
    }

    /** У компактной строки — папка текущего сегмента (`CompressedNavigationController.current` эталона). */
    public nodePath(node: FileTreeNode): string {
        if (!node.compactParents || !this.view) return node.path;
        return nodeSegments(node)[this.view.getSegmentIndex(node)] ?? node.path;
    }

    /** Для контекст-ключей `explorerViewletCompressed*`; `null` — строка не компактная или дерева нет. */
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
     * Как `getContext` эталона: одна компактная строка отдаёт папку текущего сегмента, в
     * мультивыборе — все папки цепочки (вставка потом схлопывает вложенные).
     */
    public getSelectedPaths(): string[] {
        const nodes = this.view?.getSelectedNodes() ?? [];
        if (nodes.length === 1) return [this.nodePath(nodes[0])];
        return nodes.flatMap((node) => nodeSegments(node));
    }

    /** Каталог или пустое дерево — `null`. */
    public getSelectedFilePath(): string | null {
        const node = this.view?.getSelectedNode() ?? null;
        return node !== null && !node.isDirectory ? node.path : null;
    }

    public getPasteTargetDir(): string | null {
        const node = this.view?.getSelectedNode() ?? null;
        if (!node) return this.rootPath;
        return node.isDirectory ? this.nodePath(node) : path.dirname(node.path);
    }

    /** Декорации с `propagate` всплывают к папкам; цвета уже резолвнуты, пустой список снимает все. */
    public setFileDecorations(entries: readonly IFileDecorationEntry[]): void {
        this.fileDecorations = entries;
        this.applyFileDecorations();
    }

    /** `explorer.decorations.colors`/`badges` гасят цвет и бейдж у всех строк, как в эталоне. */
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
            // Ключ строки — голова компактной цепочки, а путь узла — её последняя папка.
            const keys = paths.map((p) => this.provider?.keyForPath(p) ?? p);
            this.view.setCutKeys(new Set(keys));
        }
    }
}
