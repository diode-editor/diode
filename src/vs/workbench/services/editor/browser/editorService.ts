import * as path from "node:path";

import { Disposable, type IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { CompletionResolver, CompletionSource } from "../../../../editor/common/languages/iCompletionSource.ts";
import type { DefinitionSource } from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { FoldingRangeSource } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ITokenStyleResolver } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContextMenuController } from "../../../../editor/contrib/contextmenu/browser/contextMenuController.ts";
import { ContextMenuControllerDIToken } from "../../../../editor/contrib/contextmenu/browser/contextMenuController.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import { IFileWatcherDIToken } from "../../../../platform/files/common/iFileWatcherDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import { UndoRedoService, UndoRedoServiceDIToken } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IActivatable } from "../../../browser/iActivatable.ts";
import { EditorComponent } from "../../../browser/parts/editor/editorComponent.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import {
    LanguageServiceDIToken,
    TokenizationRegistryDIToken,
    TokenStyleResolverDIToken,
} from "../../../common/coreTokens.ts";
import { EditorGroup, type GroupId } from "./editorGroupModel.ts";
import type { IShutdownDirtyItem, IShutdownParticipant } from "../../lifecycle/browser/lifecycleService.ts";
import type { SaveParticipant } from "../../textfile/common/iSaveParticipant.ts";
import { TextFileModel } from "../../textfile/common/textFileModel.ts";
import { TextFileModelRegistry } from "../../textfile/common/textFileModelRegistry.ts";
import type { ThemeService } from "../../themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../themes/common/themeTokens.ts";

export const EditorServiceDIToken = token<EditorService>("EditorService");

/** Событие изменения полосы групп (для view-слоя и host-адаптеров). */
export interface IGroupsChangeEvent {
    readonly kind: "added" | "removed" | "moved";
    readonly group: EditorGroup;
    /** Позиция группы в полосе (для added/moved — новая). */
    readonly index: number;
    /** Группа-источник сплита (view-слой делит её долю пополам). */
    readonly source?: EditorGroup;
}

/** Метаданные сохранённого редактора для проекции в subprocess (did-save). */
export interface IEditorSavedMeta {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
}

/**
 * Логика группы редакторов без view (этап 9b Workbench-рефакторинга, аналог
 * `IEditorService`): владеет списком открытых пар {@link TextEditorPane}
 * (`TextFileModel` + `EditorComponent`), активной вкладкой и MRU-порядком
 * (Ctrl+Tab), открывает/закрывает ресурсы и применяет `editor.*`-настройки.
 * Про групповой контрол (`EditorGroupComponent`) не знает — тот подписан
 * на {@link onDidChangeEditors} и сам вставляет view активного редактора и
 * перерисовывает табы.
 */
export class EditorService extends Disposable implements IShutdownParticipant, IActivatable {
    public static dependencies = [
        ThemeServiceDIToken,
        TokenizationRegistryDIToken,
        TokenStyleResolverDIToken,
        LanguageServiceDIToken,
        IConfigurationServiceDIToken,
        UndoRedoServiceDIToken,
        IFileWatcherDIToken,
        ContextMenuControllerDIToken,
        ILogServiceDIToken,
    ] as const;

    /**
     * Полоса групп в порядке ViewColumn − 1. Пока сплитов нет — ровно одна;
     * вкладочная поверхность сервиса (activeIndex, activateTab, closeTab, MRU)
     * делегирует в активную группу.
     */
    private groupsList: EditorGroup[] = [];
    private activeGroupValue!: EditorGroup;
    /** Монотонный счётчик стабильных id групп (не переиспользуется). */
    private groupIdCounter = 0;
    /** Владение группой и подписками на её события; чистится при схлопывании. */
    private readonly groupSubscriptions = new Map<GroupId, IDisposable[]>();
    /**
     * Реестр моделей открытых файлов: один {@link TextFileModel} на ресурс при
     * любом числе показывающих его вкладок; вкладка владеет ссылкой, модель
     * умирает с последней. Безымянные и синтетические буферы — мимо реестра.
     */
    private readonly modelRegistry = new TextFileModelRegistry((uri) => this.createFileModel(uri));
    /**
     * Редакторы вне таб-строки (нижняя Panel: Output). Держим отдельным списком
     * именно затем, чтобы весь код вкладок — `getEditors`, `editorCount`,
     * `getOpenFilePaths`, `collectDirty` — продолжал ходить по группам и
     * не знал о них вовсе. Виден detached-редактор ровно в одном месте:
     * {@link getActivePane}, когда фокус внутри него.
     */
    private detachedPanes: TextEditorPane[] = [];
    private themeService: ThemeService;
    private tokenizationRegistry: TokenizationRegistry;
    private tokenStyleResolver: ITokenStyleResolver;
    private languageService: ILanguageService;
    private configurationService: IConfigurationService;
    private undoRedoService: UndoRedoService;
    private fileWatcher: IFileWatcher;
    private contextMenuController: ContextMenuController;
    private readonly logger: ILogger;
    private activeEditorListeners: ((editor: TextEditorPane | null) => void)[] = [];
    private editorSavedListeners: ((meta: IEditorSavedMeta) => void)[] = [];
    private editorsChangedListeners: (() => void)[] = [];
    private activeSelectionListeners: ((editor: TextEditorPane) => void)[] = [];
    /** Подписка на выделение активного редактора; перевешивается при его смене. */
    private activeSelectionSubscription?: IDisposable;
    private saveParticipantValue?: SaveParticipant;
    private foldingRangeSourceValue?: FoldingRangeSource;
    /**
     * Монотонный счётчик номеров безымянных буферов (`Untitled-1`, `Untitled-2`, …).
     * Не переиспользуется при закрытии вкладок — как в VS Code, номер стабилен за
     * буфером всю его жизнь.
     */
    private untitledCounter = 0;

    private activeGroupListeners: ((group: EditorGroup) => void)[] = [];
    private groupsChangedListeners: ((event: IGroupsChangeEvent) => void)[] = [];

    /**
     * Хук view-слоя «влезет ли ещё одна группа» ({@link EditorPartComponent}
     * спрашивает свой `EditorPartElement.canFit`). Не задан (headless-тесты) —
     * место не проверяется.
     */
    public canAddGroupHook?: () => boolean;

    /**
     * Хук view-слоя «сфокусируй содержимое группы»: активную вкладку либо filler
     * пустой группы — сервису filler недоступен. Не задан — фокус в активную
     * вкладку напрямую.
     */
    public focusGroupContentHook?: (group: EditorGroup) => void;

    public onRequestConfirmClose?: (group: EditorGroup, index: number) => void;
    public onEditorCreate?: (pane: TextEditorPane) => void;

    /**
     * Источник автодополнений (host/харнесс подключает сюда провайдеры
     * расширений через `languages.provideCompletionItems`). Читается
     * `CompletionService` при триггере; в редакторы не раздаётся (group-level).
     */
    public completionSource?: CompletionSource;

    /**
     * Ленивая догрузка выбранного пункта автодополнения (`resolveCompletionItem`
     * провайдера). Отдельный seam, а не поле пункта: у стокового LSP-стека
     * описание и авто-импорт приходят ТОЛЬКО по запросу конкретного пункта, уже
     * после показа списка.
     */
    public completionResolver?: CompletionResolver;

    /**
     * Символы, после набора которых попап открывается сам (`.` у tsserver) —
     * их объявляет language server, а host передаёт сюда.
     */
    public completionTriggerCharacters: readonly string[] = [];

    /**
     * Definition-источник (host/харнесс подключает сюда провайдеры расширений
     * через `languages.provideDefinition`). Читается `DefinitionService` по
     * команде Go to Definition; в редакторы не раздаётся (group-level).
     */
    public definitionSource?: DefinitionSource;

    /**
     * Save-участник, прокидываемый в каждый редактор группы (host/харнесс
     * подключает сюда `onWillSaveTextDocument`). Присваивание раздаёт участника
     * уже открытым редакторам и всем последующим (в openFile).
     */
    public get saveParticipant(): SaveParticipant | undefined {
        return this.saveParticipantValue;
    }

    public set saveParticipant(participant: SaveParticipant | undefined) {
        this.saveParticipantValue = participant;
        for (const editor of this.textPanes()) {
            editor.saveParticipant = participant;
        }
    }

    /**
     * Folding-источник, прокидываемый в каждый редактор группы (host/харнесс
     * подключает сюда `languages.provideFoldingRanges`). Присваивание раздаёт
     * источник уже открытым редакторам и всем последующим (в openFile) — extension
     * host мог активироваться уже после открытия первого файла.
     */
    public get foldingRangeSource(): FoldingRangeSource | undefined {
        return this.foldingRangeSourceValue;
    }

    public set foldingRangeSource(source: FoldingRangeSource | undefined) {
        this.foldingRangeSourceValue = source;
        for (const editor of this.textPanes()) {
            editor.foldingRangeSource = source;
        }
    }

    /**
     * Смена курсора/выделения в **активном** редакторе группы. Подписка живёт на
     * уровне группы и сама переезжает на новый активный редактор, так что
     * потребителю (extension host, проецирующий выделение в субпроцесс) не нужно
     * следить за вкладками.
     */
    public onDidChangeActiveEditorSelection(cb: (editor: TextEditorPane) => void): IDisposable {
        this.activeSelectionListeners.push(cb);
        // Первый подписчик приходит уже после openFile — подцепляем текущий редактор.
        if (this.activeSelectionSubscription === undefined) {
            this.rebindActiveSelectionForwarding(this.getActiveEditor());
        }
        return {
            dispose: () => {
                const idx = this.activeSelectionListeners.indexOf(cb);
                if (idx >= 0) this.activeSelectionListeners.splice(idx, 1);
            },
        };
    }

    public onActiveEditorChanged(cb: (editor: TextEditorPane | null) => void): IDisposable {
        this.activeEditorListeners.push(cb);
        return {
            dispose: () => {
                const idx = this.activeEditorListeners.indexOf(cb);
                if (idx >= 0) this.activeEditorListeners.splice(idx, 1);
            },
        };
    }

    /**
     * Агрегированное событие сохранения любого редактора группы (host мапит его
     * в `workspace.didSaveTextDocument`). Отдельно от per-editor `onDidSave`,
     * который занят синхронизацией вкладок.
     */
    public onEditorSaved(cb: (meta: IEditorSavedMeta) => void): IDisposable {
        this.editorSavedListeners.push(cb);
        return {
            dispose: () => {
                const idx = this.editorSavedListeners.indexOf(cb);
                if (idx >= 0) this.editorSavedListeners.splice(idx, 1);
            },
        };
    }

    /**
     * Любое изменение, требующее пересинхронизации группового view: список
     * вкладок, их метки/маркеры изменённости, активная вкладка, view активного
     * редактора. Подписчик — `EditorGroupComponent` (перерисовывает tab strip
     * и вставляет контент). Файрится ДО {@link onActiveEditorChanged}, чтобы к
     * моменту листенеров (и фокуса) view активного редактора уже стоял в дереве.
     */
    public onDidChangeEditors(cb: () => void): IDisposable {
        this.editorsChangedListeners.push(cb);
        return {
            dispose: () => {
                const idx = this.editorsChangedListeners.indexOf(cb);
                if (idx >= 0) this.editorsChangedListeners.splice(idx, 1);
            },
        };
    }

    public constructor(
        themeService: ThemeService,
        tokenizationRegistry: TokenizationRegistry,
        tokenStyleResolver: ITokenStyleResolver,
        languageService: ILanguageService,
        configurationService: IConfigurationService,
        undoRedoService: UndoRedoService,
        fileWatcher: IFileWatcher,
        contextMenuController: ContextMenuController,
        logService: ILogService,
    ) {
        super();
        this.themeService = themeService;
        this.tokenizationRegistry = tokenizationRegistry;
        this.tokenStyleResolver = tokenStyleResolver;
        this.languageService = languageService;
        this.configurationService = configurationService;
        this.undoRedoService = undoRedoService;
        this.fileWatcher = fileWatcher;
        this.contextMenuController = contextMenuController;
        this.logger = logService.createLogger("workbench.editorGroups");
        // Полоса групп начинается с единственной — она же активная.
        this.activeGroupValue = this.createGroup();
        // Владение оставшимися группами: схлопнутые чистятся по ходу, остальные —
        // при выключении сервиса.
        this.register({
            dispose: () => {
                for (const subscriptions of this.groupSubscriptions.values()) {
                    for (const subscription of subscriptions) subscription.dispose();
                }
                this.groupSubscriptions.clear();
            },
        });
        // Live-reload: при изменении `editor.*` настроек перепримeняем их ко всем
        // открытым редакторам группы (не только к вновь создаваемым).
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration("editor")) return;
                for (const editor of this.textPanes()) {
                    this.applyConfigurationToEditor(editor);
                }
            }),
        );
    }

    // ─── Группы: полоса и активная группа ─────────────────────────────────────

    /** Полоса групп в порядке ViewColumn − 1. */
    public get groups(): readonly EditorGroup[] {
        return this.groupsList;
    }

    /** Активная группа — та, по чьим вкладкам работает фасад сервиса. */
    public get activeGroup(): EditorGroup {
        return this.activeGroupValue;
    }

    /** Группа, содержащая вкладку, либо `null` (detached-панели групп не имеют). */
    public groupOf(pane: IEditorPane): EditorGroup | null {
        for (const group of this.groupsList) {
            if (group.getPanes().includes(pane)) return group;
        }
        return null;
    }

    /** Номер колонки группы (1..N) — производный от позиции в полосе. */
    public viewColumnOf(group: EditorGroup): number {
        return this.groupsList.indexOf(group) + 1;
    }

    /** Смена активной группы (сплит, фокус-команды, клик мышью в другую группу). */
    public onDidActiveGroupChange(cb: (group: EditorGroup) => void): IDisposable {
        this.activeGroupListeners.push(cb);
        return {
            dispose: () => {
                const idx = this.activeGroupListeners.indexOf(cb);
                if (idx >= 0) this.activeGroupListeners.splice(idx, 1);
            },
        };
    }

    /** Структурное изменение полосы: группа добавлена/удалена/переставлена. */
    public onDidGroupsChange(cb: (event: IGroupsChangeEvent) => void): IDisposable {
        this.groupsChangedListeners.push(cb);
        return {
            dispose: () => {
                const idx = this.groupsChangedListeners.indexOf(cb);
                if (idx >= 0) this.groupsChangedListeners.splice(idx, 1);
            },
        };
    }

    /**
     * Сплит: новая группа справа от активной с дублем её активной вкладки
     * (общий документ через реестр моделей; каретка и скролл скопированы) —
     * VS Code `workbench.action.splitEditor`. Отказ: пустая активная группа
     * либо не хватает места ({@link canAddGroupHook}; молча, с записью в лог —
     * решение постановки №3). Возвращает новую группу либо `null` при отказе.
     */
    public splitActiveGroup({
        focus = true,
        position = "after",
    }: { focus?: boolean; position?: "before" | "after" } = {}): EditorGroup | null {
        const source = this.activeGroupValue;
        const sourcePane = source.activePane;
        if (sourcePane === null) return null;
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("split refused — not enough space");
            return null;
        }

        const anchor = this.groupsList.indexOf(source);
        const index = position === "before" ? anchor : anchor + 1;
        const group = this.createGroup(index);
        this.fireGroupsChanged({ kind: "added", group, index, source });

        // Дубль активной вкладки. Общая модель — только у файлов (реестр);
        // untitled/дифф не дублируются — новая группа остаётся пустой.
        if (sourcePane instanceof TextEditorPane && sourcePane.uri.scheme === "file") {
            const ref = this.modelRegistry.acquire(sourcePane.uri);
            const copy = this.createPaneForModel(ref.model, ref);
            this.applyConfigurationToEditor(copy);
            // Каретка и скролл — как в источнике (US-1). Прямое присваивание, без
            // reveal: восстановленная позиция и так была видима в источнике.
            copy.viewState.selections = sourcePane.viewState.cloneSelections();
            copy.viewState.scrollTop = sourcePane.viewState.scrollTop;
            copy.viewState.scrollLeft = sourcePane.viewState.scrollLeft;
            group.insertPane(copy);
        }

        this.activeGroupValue = group;
        if (group.editorCount > 0) {
            group.activateTab(0, { focus });
        } else {
            this.fireActiveEditorChanged(null);
            if (focus) this.focusGroupContent(group);
        }
        this.fireActiveGroupChanged(group);
        return group;
    }

    /**
     * Пустая группа рядом с активной (`workbench.action.newGroup*`). Отказ по
     * месту — как у {@link splitActiveGroup}.
     */
    public newGroup(position: "before" | "after", { focus = true }: { focus?: boolean } = {}): EditorGroup | null {
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("new group refused — not enough space");
            return null;
        }
        const anchor = this.groupsList.indexOf(this.activeGroupValue);
        const index = position === "before" ? anchor : anchor + 1;
        const group = this.createGroup(index);
        this.fireGroupsChanged({ kind: "added", group, index });
        this.activeGroupValue = group;
        this.fireActiveEditorChanged(null);
        if (focus) this.focusGroupContent(group);
        this.fireActiveGroupChanged(group);
        return group;
    }

    /**
     * Фокус группы: по стабильному id, позиции в полосе, соседству или циклом.
     * Делает группу активной и передаёт фокус её содержимому (активной вкладке
     * либо filler'у пустой группы). За краем полосы — no-op (US-10).
     */
    public focusGroup(
        target: GroupId | { index: number } | { direction: "next" | "previous" | "cycle" },
        { focus = true }: { focus?: boolean } = {},
    ): void {
        const group = this.resolveGroupTarget(target);
        if (group === null) return;
        this.makeGroupActive(group);
        if (focus) this.focusGroupContent(group);
    }

    private resolveGroupTarget(
        target: GroupId | { index: number } | { direction: "next" | "previous" | "cycle" },
    ): EditorGroup | null {
        if (typeof target === "number") {
            return this.groupsList.find((group) => group.id === target) ?? null;
        }
        if ("index" in target) {
            return this.groupsList[target.index] ?? null;
        }
        const current = this.groupsList.indexOf(this.activeGroupValue);
        if (target.direction === "cycle") {
            return this.groupsList[(current + 1) % this.groupsList.length];
        }
        const next = target.direction === "next" ? current + 1 : current - 1;
        return this.groupsList[next] ?? null;
    }

    /**
     * Мышь/фокус сделали группу активной (capture-listener на поддереве группы —
     * ставит `EditorPartComponent`). Фокус уже там, куда кликнули, — только
     * события; группа уже активна — no-op.
     */
    public notifyGroupFocused(group: EditorGroup): void {
        if (group === this.activeGroupValue) return;
        this.makeGroupActive(group);
    }

    /**
     * Переносит активную вкладку в соседнюю группу; у единственной группы
     * создаёт соседку и переносит (US-50). Фокус едет со вкладкой; опустевшая
     * группа-источник схлопывается сама. Ресурс уже открыт в целевой группе —
     * переносимая вкладка сливается с существующей (пер-группный дедуп).
     */
    public moveActiveEditorToGroup(
        direction: "next" | "previous",
        { focus = true }: { focus?: boolean } = {},
    ): void {
        const source = this.activeGroupValue;
        const index = source.activeIndex;
        if (source.activePane === null) return;
        const target = this.neighborOrNewGroup(direction);
        if (target === null) return;

        // detachPane может схлопнуть опустевший источник (collapse внутри) —
        // целевая группа взята по ссылке заранее и переживает перестройку полосы.
        const pane = source.detachPane(index);
        /* v8 ignore start -- activePane проверен выше, индекс валиден */
        if (pane === null) return;
        /* v8 ignore stop */
        this.activeGroupValue = target;
        const existing = target.findPaneIndex(pane.uri);
        if (existing >= 0) {
            pane.dispose();
            target.activateTab(existing, { focus });
        } else {
            target.insertPane(pane);
            target.activateTab(target.editorCount - 1, { focus });
        }
        this.fireActiveGroupChanged(target);
    }

    /**
     * Копия активной вкладки в соседнюю группу (US-17): общий документ через
     * реестр, каретка/скролл скопированы. Только файловые вкладки — untitled и
     * дифф не дублируются. Ресурс уже в целевой — просто активируется там.
     */
    public copyActiveEditorToGroup(
        direction: "next" | "previous",
        { focus = true }: { focus?: boolean } = {},
    ): void {
        const sourcePane = this.activeGroupValue.activePane;
        if (!(sourcePane instanceof TextEditorPane) || sourcePane.uri.scheme !== "file") return;
        const target = this.neighborOrNewGroup(direction);
        if (target === null) return;

        this.activeGroupValue = target;
        const existing = target.findPaneIndex(sourcePane.uri);
        if (existing >= 0) {
            target.activateTab(existing, { focus });
        } else {
            const ref = this.modelRegistry.acquire(sourcePane.uri);
            const copy = this.createPaneForModel(ref.model, ref);
            this.applyConfigurationToEditor(copy);
            copy.viewState.selections = sourcePane.viewState.cloneSelections();
            copy.viewState.scrollTop = sourcePane.viewState.scrollTop;
            copy.viewState.scrollLeft = sourcePane.viewState.scrollLeft;
            target.insertPane(copy);
            target.activateTab(target.editorCount - 1, { focus });
        }
        this.fireActiveGroupChanged(target);
    }

    /**
     * Вливает СЛЕДУЮЩУЮ группу в активную (VS Code `joinTwoGroups`): вкладки
     * переезжают в конец, дубликаты ресурса схлопываются (решение постановки
     * №5), опустевший сосед схлопывается сам. У края полосы — no-op.
     */
    public joinTwoGroups(): void {
        const target = this.activeGroupValue;
        const source = this.resolveGroupTarget({ direction: "next" });
        if (source === null || source === target) return;
        this.mergeGroupInto(source, target);
    }

    /** Сливает все группы в первую; активная вкладка бывшей активной группы выживает (US-21). */
    public joinAllGroups(): void {
        if (this.groupsList.length < 2) return;
        const rememberedUri = this.activeGroupValue.activePane?.uri ?? null;
        const target = this.groupsList[0];
        this.activeGroupValue = target;
        while (this.groupsList.length > 1) {
            this.mergeGroupInto(this.groupsList[1], target);
        }
        if (rememberedUri !== null) {
            const index = target.findPaneIndex(rememberedUri);
            /* v8 ignore start -- uri взят с живой вкладки, merge с дедупом сохраняет ресурс в target */
            if (index >= 0) target.activateTab(index);
            /* v8 ignore stop */
        }
        this.fireActiveGroupChanged(target);
    }

    /** Переставляет активную группу по полосе (US-18); у края — no-op. */
    public moveActiveGroup(direction: "next" | "previous"): void {
        const from = this.groupsList.indexOf(this.activeGroupValue);
        const to = direction === "next" ? from + 1 : from - 1;
        if (to < 0 || to >= this.groupsList.length) return;
        const [group] = this.groupsList.splice(from, 1);
        this.groupsList.splice(to, 0, group);
        this.fireGroupsChanged({ kind: "moved", group, index: to });
    }

    /** Переливает вкладки source в target (дедуп по ресурсу) до схлопывания source. */
    private mergeGroupInto(source: EditorGroup, target: EditorGroup): void {
        if (source.editorCount === 0) {
            // Пустой сосед: некому схлопнуть его событием — снимаем явно.
            this.collapseGroup(source);
            return;
        }
        while (source.editorCount > 0) {
            const pane = source.detachPane(0);
            /* v8 ignore start -- editorCount > 0 гарантирует вкладку */
            if (pane === null) break;
            /* v8 ignore stop */
            if (target.findPaneIndex(pane.uri) >= 0) pane.dispose();
            else target.insertPane(pane);
        }
    }

    /**
     * Сосед активной группы по направлению; у единственной группы создаёт его
     * (с проверкой места), у края многогрупповой полосы — `null`.
     */
    private neighborOrNewGroup(direction: "next" | "previous"): EditorGroup | null {
        const existing = this.resolveGroupTarget({ direction });
        if (existing !== null && existing !== this.activeGroupValue) return existing;
        if (this.groupsList.length > 1) return null;
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("new group refused — not enough space");
            return null;
        }
        const index = direction === "next" ? 1 : 0;
        const group = this.createGroup(index);
        this.fireGroupsChanged({ kind: "added", group, index, source: this.activeGroupValue });
        return group;
    }

    /** Смена активной группы + фасадные события (без передачи фокуса). */
    private makeGroupActive(group: EditorGroup): void {
        if (group === this.activeGroupValue) return;
        this.activeGroupValue = group;
        // Табы/контент групп не меняются, но фасадные потребители («активный
        // редактор воркбенча») обязаны переехать: статус-бар, host, autoReveal.
        this.fireActiveEditorChanged(group.activePane);
        this.fireActiveGroupChanged(group);
    }

    /** Фокус содержимого группы: через view-хук (умеет filler), иначе — вкладка. */
    private focusGroupContent(group: EditorGroup): void {
        if (this.focusGroupContentHook !== undefined) this.focusGroupContentHook(group);
        else group.focusEditor();
    }

    /**
     * Создаёт группу на позиции `index`, включает в полосу и переподнимает её
     * события на фасадные: view-слой (`EditorGroupComponent`) слушает саму
     * группу, а потребители «активного редактора» — сервис. Группа, оставшаяся
     * без вкладок, схлопывается (кроме последней — US-47).
     */
    private createGroup(index: number = this.groupsList.length): EditorGroup {
        const group = new EditorGroup(++this.groupIdCounter);
        this.groupsList.splice(index, 0, group);
        const subscriptions: IDisposable[] = [
            group,
            group.onDidChangeEditors(() => {
                this.fireEditorsChanged();
            }),
            group.onDidChangeActivePane((pane) => {
                // Смена вкладки неактивной группы не трогает активный редактор
                // воркбенча (US-13: MRU и активность — пер-группные).
                if (group === this.activeGroupValue) this.fireActiveEditorChanged(pane);
                if (pane === null && group.editorCount === 0 && this.groupsList.length > 1) {
                    this.collapseGroup(group);
                }
            }),
        ];
        this.groupSubscriptions.set(group.id, subscriptions);
        return group;
    }

    /**
     * Схлопывает опустевшую группу: полоса сжимается, соседка получает фокус,
     * если схлопнулась активная. Последнюю группу не схлопываем — пустая область
     * редактора легальна (US-47).
     */
    private collapseGroup(group: EditorGroup): void {
        const index = this.groupsList.indexOf(group);
        /* v8 ignore start -- защитный гард: схлопывание зовётся только для группы из полосы */
        if (index < 0) return;
        /* v8 ignore stop */
        this.groupsList.splice(index, 1);
        /* v8 ignore start -- подписки заводит createGroup для каждой группы, фолбэк ?? [] недостижим */
        for (const subscription of this.groupSubscriptions.get(group.id) ?? []) subscription.dispose();
        /* v8 ignore stop */
        this.groupSubscriptions.delete(group.id);
        const wasActive = group === this.activeGroupValue;
        this.fireGroupsChanged({ kind: "removed", group, index });
        if (wasActive) {
            const neighbor = this.groupsList[Math.max(0, index - 1)];
            this.activeGroupValue = neighbor;
            this.fireActiveEditorChanged(neighbor.activePane);
            this.fireActiveGroupChanged(neighbor);
            this.focusGroupContent(neighbor);
        }
    }

    private fireActiveGroupChanged(group: EditorGroup): void {
        for (const cb of [...this.activeGroupListeners]) cb(group);
    }

    private fireGroupsChanged(event: IGroupsChangeEvent): void {
        for (const cb of [...this.groupsChangedListeners]) cb(event);
    }

    /** Позиция активной вкладки активной группы. */
    public get activeIndex(): number {
        return this.activeGroupValue.activeIndex;
    }

    /** Число вкладок активной группы. */
    public get editorCount(): number {
        return this.activeGroupValue.editorCount;
    }

    // ─── Панели: generic-поверхность для группы и вкладок ─────────────────────

    /**
     * Активная панель любого вида (текст, дифф, …) — та, по которой работают
     * команды.
     *
     * Detached-панель (Output) вкладкой не является, но когда фокус внутри неё,
     * активна именно она: иначе стрелки и Ctrl+F исполнялись бы по файлу за
     * панелью. Аналог `ICodeEditorService.getFocusedCodeEditor()` в VS Code.
     */
    public getActivePane(): IEditorPane | null {
        const focused = this.focusedDetachedPane();
        if (focused !== null) return focused;
        return this.getActiveTabPane();
    }

    /**
     * Активная **вкладка** — без учёта detached-панелей. Отдельно от
     * {@link getActivePane} затем, что «панель, по которой работают команды» и
     * «панель-вкладка» — разные вещи. Вкладка нужна тем, кто:
     * - вставляет контент в область редактора (`EditorGroupComponent`) — иначе
     *   на экран попал бы редактор нижней панели;
     * - уводит фокус ИЗ панели (`PanelFocusContribution`, умерший терминал) —
     *   иначе фокус отскакивал бы обратно в панель;
     * - показывает расширениям `activeTextEditor` — как и в VS Code, фокус в
     *   панели не должен подменять расширению активный текстовый редактор.
     */
    public getActiveTabPane(): IEditorPane | null {
        return this.activeGroupValue.activePane;
    }

    /**
     * Detached-панель, внутри которой сейчас фокус (или `null`). Проверка — по
     * пути от активного элемента вверх, как `holdsFocus` у виджета терминала.
     */
    private focusedDetachedPane(): TextEditorPane | null {
        if (this.detachedPanes.length === 0) return null;
        for (const pane of this.detachedPanes) {
            const active = pane.view.getRoot()?.focusManager?.activeElement ?? null;
            if (active !== null && active.getAncestorPath().includes(pane.view)) return pane;
        }
        return null;
    }

    public getPane(index: number): IEditorPane | null {
        return this.activeGroupValue.getPane(index);
    }

    /** Открытые панели активной группы в позиционном порядке вкладок. */
    public getPanes(): readonly IEditorPane[] {
        return this.activeGroupValue.getPanes();
    }

    /**
     * Открывает готовую панель не-текстового вида (дифф и т.п.). Идентичность —
     * по ресурсу в пределах группы, как и у файлов: повторный вызов переключает
     * на существующую вкладку, а не заводит вторую.
     */
    public openPane(pane: IEditorPane, { focus = true }: { focus?: boolean } = {}): void {
        const group = this.activeGroupValue;
        const existingIndex = group.findPaneIndex(pane.uri);
        if (existingIndex >= 0) {
            pane.dispose();
            this.activateTab(existingIndex, { focus });
            return;
        }
        group.insertPane(pane);
        group.activateTab(group.editorCount - 1, { focus });
    }

    // ─── Текстовая поверхность: сужение generic-списка ────────────────────────

    /**
     * Активный **текстовый** редактор, либо `null` — в том числе когда активна
     * панель другого вида. Так все потребители текста (команды правки, find,
     * автодополнение, статус-бар, host-адаптеры) молча ничего не делают на
     * диффе, вместо того чтобы падать или требовать проверок на каждом вызове.
     */
    public getActiveEditor(): TextEditorPane | null {
        const pane = this.getActivePane();
        // Стороны диффа v2 — настоящие текстовые панели: команды курсора,
        // фолдинга и статус-бар работают в активной стороне, а не глохнут
        // (резолвнувшаяся команда съедает клавишу — молчаливый null онемел бы
        // всю вкладку).
        if (pane instanceof DiffEditorPane2) return pane.activeTextPane;
        return pane instanceof TextEditorPane ? pane : null;
    }

    /**
     * Текстовая поверхность активной панели — редактора ИЛИ диффа, — либо
     * `null`, если у панели её нет. Уже, чем {@link getActiveEditor}: командам
     * курсора, выделения и копирования нужен только `EditorViewState`, а не
     * текстовая вкладка со своими save/EOL/кодировкой. Именно за счёт этого
     * дифф ходит кареткой тем же кодом, что и редактор, оставаясь read-only.
     */
    public getActiveViewState(): EditorViewState | null {
        return this.getActivePane()?.viewState ?? null;
    }

    /** Текстовая вкладка без учёта detached-панелей (см. {@link getActiveTabPane}). */
    public getActiveTabEditor(): TextEditorPane | null {
        const pane = this.getActiveTabPane();
        return pane instanceof TextEditorPane ? pane : null;
    }

    /**
     * Создаёт редактор ВНЕ таб-строки: он не попадает ни в `getPanes`, ни в
     * персист сессии, ни в shutdown-протокол — те ходят по `this.panes`.
     * Ресурс синтетический (`output:<channel>`), содержимое даёт владелец через
     * `TextEditorPane.model`. Владелец же и решает, куда вставить `pane.view`.
     */
    public openDetached(uri: Uri, languageId: string): TextEditorPane {
        // Синтетический ресурс уникален по построению — модель мимо реестра.
        const model = new TextFileModel(this.languageService, this.undoRedoService);
        this.wireModel(model);
        model.openSynthetic(uri, languageId);
        const editor = this.createPaneForModel(model);
        editor.detached = true;
        // Вкладочные панели обвязывает группа; detached — сам сервис.
        this.wirePane(editor);
        this.applyConfigurationToEditor(editor);
        this.detachedPanes.push(editor);
        return editor;
    }

    /**
     * Открывает **вкладку-снимок**: текстовую read-only вкладку с содержимым,
     * которого нет на диске (файл на ревизии из `git:`-провайдера). Модель
     * синтетическая — контент даёт вызывающий, а не файловая система, поэтому
     * ни watcher'а, ни save (`"no-file"`), ни персиста сессии у неё нет.
     * Идентичность — по ресурсу в пределах группы, как у всех вкладок:
     * повторный вызов с тем же uri обновляет содержимое существующей вкладки
     * и активирует её (ветка на том же ресурсе могла сдвинуться).
     */
    public openTextSnapshot(
        uri: Uri,
        { text, languageId, label, focus = true }: { text: string; languageId: string; label: string; focus?: boolean },
    ): TextEditorPane {
        const group = this.activeGroupValue;
        const existingIndex = group.findPaneIndex(uri);
        if (existingIndex >= 0) {
            const existing = group.getPane(existingIndex);
            /* v8 ignore start -- defensive: снимок по этому uri открывает только этот метод, вид панели известен */
            if (existing instanceof TextEditorPane) {
                /* v8 ignore stop */
                existing.model.replaceOwnedContent(text);
                this.activateTab(existingIndex, { focus });
                return existing;
            }
        }

        // Снимок уникален по построению (uri несёт ревизию) — модель мимо реестра.
        const model = new TextFileModel(this.languageService, this.undoRedoService);
        this.wireModel(model);
        model.openSynthetic(uri, languageId);
        model.replaceOwnedContent(text);
        const editor = this.createPaneForModel(model);
        editor.labelOverride = label;
        this.applyConfigurationToEditor(editor);
        editor.readOnly = true;
        group.insertPane(editor);
        group.activateTab(group.editorCount - 1, { focus });
        return editor;
    }

    /** Текстовый редактор по позиции вкладки; `null`, если там панель другого вида. */
    public getEditor(index: number): TextEditorPane | null {
        const pane = this.getPane(index);
        return pane instanceof TextEditorPane ? pane : null;
    }

    /** Открытые текстовые редакторы ВСЕХ групп — без панелей других видов. */
    public getEditors(): readonly TextEditorPane[] {
        return this.textPanes();
    }

    /** Текстовые вкладки всех групп в порядке полосы (декорации, конфиг, персист). */
    private textPanes(): TextEditorPane[] {
        return this.allPanes().filter((pane): pane is TextEditorPane => pane instanceof TextEditorPane);
    }

    /** Вкладки всех групп в порядке полосы. */
    private allPanes(): IEditorPane[] {
        return this.groupsList.flatMap((group) => [...group.getPanes()]);
    }

    /**
     * Абсолютные пути открытых файлов в позиционном порядке вкладок — снимок для
     * персистентности сессии (см. `WorkbenchStateService`). Безымянные буферы
     * (без пути на диске) пропускаются: их нечего восстанавливать по пути.
     */
    public getOpenFilePaths(): string[] {
        const paths: string[] = [];
        for (const editor of this.textPanes()) {
            if (editor.absoluteFilePath !== null) paths.push(editor.absoluteFilePath);
        }
        return paths;
    }

    /**
     * Открывает файл по пути — строковая парадная дверь группы (CLI, дерево, сессия).
     *
     * Единственная точка подъёма строки в ресурс. `path.resolve` обязан стоять вплотную
     * перед `Uri.file`: пути приходят относительными, а `Uri.file` их НЕ резолвит —
     * просто префиксует слэшем, и резолвить после подъёма было бы уже поздно.
     */
    public openFile(filePath: string, options: { focus?: boolean; group?: "beside" } = {}): void {
        this.openUri(Uri.file(path.resolve(filePath)), options);
    }

    /**
     * Открывает ресурс по uri — вход для тех, у кого он уже есть (диагностики).
     * `group: "beside"` — открытие в соседней справа группе (Open to the Side,
     * Go to Definition to the Side); соседки нет — она создаётся (при нехватке
     * места — фолбэк в активную, с записью в лог).
     */
    public openUri(uri: Uri, { focus = true, group: where }: { focus?: boolean; group?: "beside" } = {}): void {
        // Идентичность вкладки — по ресурсу целиком В ПРЕДЕЛАХ группы, а не по
        // имени файла: два разных файла с одинаковым basename должны открываться
        // в отдельных вкладках, а тот же ресурс в другой группе — своей вкладкой
        // (общая модель через реестр).
        const group = where === "beside" ? this.resolveBesideGroup() : this.activeGroupValue;
        const wasActive = group === this.activeGroupValue;
        this.activeGroupValue = group;
        const existingIndex = group.findPaneIndex(uri);
        if (existingIndex >= 0) {
            group.activateTab(existingIndex, { focus });
        } else {
            // Модель приходит из реестра уже загруженной (фабрика ставит watcher
            // до openFile); вкладка владеет ссылкой, а не самой моделью.
            const ref = this.modelRegistry.acquire(uri);
            const editor = this.createPaneForModel(ref.model, ref);
            this.applyConfigurationToEditor(editor);
            group.insertPane(editor);
            group.activateTab(group.editorCount - 1, { focus });
        }
        if (!wasActive) this.fireActiveGroupChanged(group);
    }

    /** Группа справа от активной; нет — создаётся (нет места — фолбэк в активную). */
    private resolveBesideGroup(): EditorGroup {
        const index = this.groupsList.indexOf(this.activeGroupValue);
        const next = this.groupsList[index + 1];
        if (next !== undefined) return next;
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("open beside refused — not enough space, opening in the active group");
            return this.activeGroupValue;
        }
        const group = this.createGroup(index + 1);
        this.fireGroupsChanged({ kind: "added", group, index: index + 1, source: this.activeGroupValue });
        return group;
    }

    /**
     * Открывает новый безымянный буфер (VS Code `workbench.action.files.newUntitledFile`).
     * В отличие от {@link openFile}, не загружает файл и не ставит слежение —
     * `filePath` остаётся `null`, путь запрашивается при первом сохранении (Save As).
     */
    public newUntitled({ focus = true }: { focus?: boolean } = {}): void {
        // Безымянный буфер уникален по построению — модель мимо реестра,
        // вкладка владеет ею единолично.
        const model = new TextFileModel(this.languageService, this.undoRedoService);
        this.wireModel(model);
        const editor = this.createPaneForModel(model);
        // Файл не грузим (view-state из конструктора не пересоздаётся) — конфиг
        // применяем сразу.
        this.applyConfigurationToEditor(editor);
        // Номер выдаём до вставки: пока редактора нет в списке вкладок, его никто не видит.
        editor.setUntitled(++this.untitledCounter);
        const group = this.activeGroupValue;
        group.insertPane(editor);
        group.activateTab(group.editorCount - 1, { focus });
    }

    /**
     * Фабрика реестра моделей: модель файла + модельная обвязка + загрузка.
     * Наблюдатель ставится до openFile ({@link wireModel}), чтобы слежение
     * началось с первой загрузки.
     */
    private createFileModel(uri: Uri): TextFileModel {
        const model = new TextFileModel(this.languageService, this.undoRedoService);
        this.wireModel(model);
        model.openFile(uri);
        return model;
    }

    /**
     * Модельная обвязка — ставится один раз на документ, а не на вкладку:
     * watcher, save-участник и событие сохранения принадлежат файлу, сколько бы
     * вью его ни показывало.
     */
    private wireModel(model: TextFileModel): void {
        model.fileWatcher = this.fileWatcher;
        model.saveParticipant = this.saveParticipantValue;
        model.onDidSave = () => {
            // saveAs мог сменить ресурс — реестр перепривязывает ключ.
            this.modelRegistry.handleUriChanged(model);
            this.fireEditorsChanged();
            this.fireModelSaved(model);
        };
    }

    /**
     * Создаёт view-часть вкладки поверх модели ({@link EditorComponent} +
     * транзитный {@link TextEditorPane}) и навешивает вкладочную обвязку
     * (контекст-меню, подписки → {@link onDidChangeEditors}, folding-источник,
     * `onEditorCreate`). `modelOwnership` — ссылка реестра, которой владеет
     * вкладка; без неё вкладка владеет моделью единолично (untitled, detached).
     */
    private createPaneForModel(model: TextFileModel, modelOwnership?: IDisposable): TextEditorPane {
        const component = new EditorComponent(
            this.tokenizationRegistry,
            this.tokenStyleResolver,
            model,
        );
        const editor = new TextEditorPane(model, component, modelOwnership);
        // Политика контекстного меню редактора слушает "contextmenu" на обвязке
        // пары: ScrollBarDecorator переживает пересоздание EditorElement при
        // перечитке, сам элемент контроллер берёт из цели события.
        this.contextMenuController.attach(component.view);
        editor.foldingRangeSource = this.foldingRangeSourceValue;
        this.onEditorCreate?.(editor);
        return editor;
    }

    /**
     * Обвязка detached-панели: владение временем жизни и перерисовка таб-стрипа
     * по изменению видимого. Вкладочные панели обвязывает сама группа в
     * `insertPane` — этот путь остался только для панелей вне таб-строки.
     */
    private wirePane(pane: IEditorPane): void {
        this.register(pane);
        this.register(
            pane.onDidChangeState(() => {
                this.fireEditorsChanged();
            }),
        );
    }

    /** Переключение вкладки активной группы (порядок событий — контракт группы). */
    public activateTab(index: number, options: { focus?: boolean; mru?: boolean } = {}): void {
        this.activeGroupValue.activateTab(index, options);
    }

    /** MRU-переключение вкладок активной группы (Ctrl+Tab / Ctrl+Shift+Tab). */
    public cycleMru(direction: 1 | -1): void {
        this.activeGroupValue.cycleMru(direction);
    }

    /** Завершает серию Ctrl+Tab активной группы (по отпусканию Ctrl). */
    public endMruCycle(): void {
        this.activeGroupValue.endMruCycle();
    }

    /** Снимок MRU-порядка активной группы (mru[0] — самый недавний). */
    public getMruOrder(): IEditorPane[] {
        return this.activeGroupValue.getMruOrder();
    }

    /** Закрывает вкладку активной группы (события и фокус — контракт группы). */
    public closeTab(index: number): void {
        this.activeGroupValue.closeTab(index);
    }

    public async activate(): Promise<void> {
        // Пока нечего активировать: async-инициализация редакторов (LSP и т.п.) —
        // будущий шов сервисного слоя.
    }

    /**
     * Применяет к редактору настройки из `IConfigurationService`
     * (`editor.cursorSurroundingLines`, `editor.tabSize`, `editor.insertSpaces`).
     * Если ключ не задан, соответствующая настройка редактора не трогается
     * (`setIndentOptions` оставит существующее значение — auto-detect и т.п.).
     */
    private applyConfigurationToEditor(editor: TextEditorPane): void {
        // `editor.occurrencesHighlight`: "off" disables; "singleFile"/"multiFile"
        // (and unset → VS Code default) enable. We only support single-file scope.
        const occurrencesHighlight = this.configurationService.get<string>("editor.occurrencesHighlight");
        editor.setOccurrenceHighlightEnabled(occurrencesHighlight !== "off");

        const surroundingLines = this.configurationService.get<number>("editor.cursorSurroundingLines");
        if (surroundingLines !== undefined) {
            editor.setCursorSurroundingLines(surroundingLines);
        }

        const tabSize = this.configurationService.get<number>("editor.tabSize");
        const insertSpaces = this.configurationService.get<boolean>("editor.insertSpaces");
        if (tabSize === undefined && insertSpaces === undefined) return;
        editor.setIndentOptions({
            ...(tabSize !== undefined ? { tabSize } : {}),
            ...(insertSpaces !== undefined ? { insertSpaces } : {}),
        });
    }

    /**
     * Фокус активной **вкладки** (см. {@link getActiveTabPane} — не в панель),
     * причём любого вида: дифф тоже должен получать ввод.
     */
    public focusEditor(): void {
        this.getActiveTabPane()?.focusEditor();
    }

    /**
     * Участник shutdown-протокола ({@link IShutdownParticipant}, структурно):
     * снапшот несохранённых редакторов для последовательных confirm-save при
     * выходе. `isStillDirty` ловит вкладки, закрытые пока пользователь отвечал
     * по предыдущим диалогам; Save при выходе перезаписывает файл даже при
     * внешних изменениях — выбор пользователя не должен пропасть.
     */
    public collectDirty(): readonly IShutdownDirtyItem[] {
        const items: IShutdownDirtyItem[] = [];
        // Дедуп по модели: документ, открытый в нескольких вкладках, — одни
        // несохранённые правки и ОДИН диалог, а не по числу вкладок.
        const seenModels = new Set<TextFileModel>();
        for (const editor of this.textPanes()) {
            if (!editor.isModified) continue;
            if (seenModels.has(editor.model)) continue;
            seenModels.add(editor.model);
            items.push({
                name: this.displayName(editor),
                isStillDirty: () =>
                    this.textPanes().some((pane) => pane.model === editor.model),
                save: () => editor.save({ overwrite: true }),
            });
        }
        return items;
    }

    /**
     * Правда, если `editor` — последняя вкладка, показывающая свой документ:
     * закрытие потеряет несохранённые правки, нужен confirm-диалог. Пока документ
     * виден где-то ещё, вкладка закрывается молча — правки живут в общей модели
     * (семантика VS Code для сплитов).
     */
    public isLastPaneForDocument(editor: TextEditorPane): boolean {
        let count = 0;
        for (const pane of this.textPanes()) {
            if (pane.model === editor.model) count++;
        }
        return count <= 1;
    }

    /**
     * Имя буфера для вкладки/иконки: имя файла, либо `Untitled-N` для безымянного.
     */
    public displayName(editor: IEditorPane): string {
        return editor.label;
    }

    /**
     * Имя файла, предлагаемое при Save As безымянного буфера: метка вкладки плюс
     * расширение его текущего языка (`Untitled-1` + `plaintext` → `Untitled-1.txt`).
     *
     * Расширение выводим из языка, а не зашиваем: у свежего буфера язык `plaintext`,
     * так что дефолт остаётся `.txt`, но стоит сменить язык буфера
     * ({@link TextFileModel.setLanguage}) — и предложение поедет следом само.
     * Язык без расширений (или незарегистрированный) → имя без расширения.
     */
    public suggestedSaveName(editor: TextEditorPane): string {
        const name = this.displayName(editor);
        const extension = this.languageService.getExtensionForLanguage(editor.languageId);
        return extension === undefined ? name : `${name}${extension}`;
    }

    private fireEditorsChanged(): void {
        for (const cb of this.editorsChangedListeners) {
            cb();
        }
    }

    /**
     * Наружу отдаём только текстовую панель: подписчики
     * ({@link onActiveEditorChanged}) — это статус-бар, host-адаптеры, find и
     * прочие потребители текста. Переключение на дифф для них выглядит как «нет
     * активного редактора», что и есть правда с их точки зрения.
     */
    private fireActiveEditorChanged(pane: IEditorPane | null): void {
        const editor = pane instanceof TextEditorPane ? pane : null;
        this.rebindActiveSelectionForwarding(editor);
        for (const cb of this.activeEditorListeners) {
            cb(editor);
        }
    }

    /**
     * Перевешивает подписку на выделение с прошлого активного редактора на новый.
     * Слушателей группы ({@link onDidChangeActiveEditorSelection}) при этом не
     * дёргаем: смену активного редактора потребитель и так видит через
     * {@link onActiveEditorChanged}, которое несёт выделение в своей meta.
     */
    private rebindActiveSelectionForwarding(editor: TextEditorPane | null): void {
        this.activeSelectionSubscription?.dispose();
        this.activeSelectionSubscription = undefined;
        if (editor === null) return;
        this.activeSelectionSubscription = editor.onDidChangeSelection(() => {
            for (const cb of [...this.activeSelectionListeners]) cb(editor);
        });
    }

    private fireModelSaved(model: TextFileModel): void {
        // Ресурс есть у любого редактора — гейт на "путь не задан" больше не нужен.
        const meta: IEditorSavedMeta = { uri: model.uri.toString(), languageId: model.languageId };
        for (const cb of [...this.editorSavedListeners]) {
            cb(meta);
        }
    }
}
