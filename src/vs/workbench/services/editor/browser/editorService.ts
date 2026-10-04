import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageConfigurationService } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import {
    LanguageConfigurationServiceDIToken,
    NULL_LANGUAGE_CONFIGURATION_SERVICE,
} from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { LanguageServiceDIToken } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ITokenStyleResolver } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenStyleResolverDIToken } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { TokenizationRegistryDIToken } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { ContextMenuController } from "../../../../editor/contrib/contextmenu/browser/contextMenuController.ts";
import { ContextMenuControllerDIToken } from "../../../../editor/contrib/contextmenu/browser/contextMenuController.ts";
import { hasDocumentFormatter } from "../../../../editor/contrib/format/format.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { FileService } from "../../../../platform/files/common/fileService.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import { IFileWatcherDIToken } from "../../../../platform/files/common/iFileWatcherDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import { UndoRedoService, UndoRedoServiceDIToken } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IActivatable } from "../../../browser/iActivatable.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { isTextEditorPane, TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { SyntheticTextModel } from "../../../common/editor/syntheticTextModel.ts";
import type { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";
import type { ISerializedEditor } from "../../../common/stateKeys.ts";
import { DialogService, DialogServiceDIToken } from "../../dialogs/browser/dialogService.ts";
import type { IShutdownDirtyItem, IShutdownParticipant } from "../../lifecycle/browser/lifecycleService.ts";
import type { SaveParticipant } from "../../textfile/common/iSaveParticipant.ts";
import type { TextFileModel } from "../../textfile/common/textFileModel.ts";
import { TextFileModelService, TextFileModelServiceDIToken } from "../../textfile/common/textFileModelService.ts";
import type { ThemeService } from "../../themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../themes/common/themeTokens.ts";
import type { IVirtualDocumentSource } from "../common/iVirtualDocumentSource.ts";
import { NULL_VIRTUAL_DOCUMENT_SOURCE } from "../common/iVirtualDocumentSource.ts";

import { EditorCloseHandler } from "./editorCloseHandler.ts";
import { EditorGroup, type GroupId, type MruCycleState } from "./editorGroupModel.ts";
import {
    createTextEditorPaneFactory,
    EditorPaneFactoriesDIToken,
    type IEditorPaneFactory,
    type ITextEditorViewState,
} from "./editorPaneFactory.ts";
import {
    createCodeActionsOnSaveParticipant,
    createFormatOnSaveParticipant,
    enabledCodeActionKindsOnSave,
    type IOnSaveParticipantHost,
} from "./onSaveParticipants.ts";
import { TextEditorConfiguration } from "./textEditorConfiguration.ts";
import { TextEditorPaneBuilder, TextEditorPaneBuilderDIToken } from "./textEditorPaneBuilder.ts";

export const EditorServiceDIToken = token<EditorService>("EditorService");

/** Настройка режима предпросмотра вкладок (`workbenchConfiguration`). */
const PREVIEW_SETTING_KEY = "workbench.editor.enablePreview";

/** Параметры {@link EditorService.openUri}. */
export interface IOpenUriOptions {
    readonly focus?: boolean;
    /**
     * Куда открыть: по умолчанию — активная группа; `"beside"` — соседняя справа
     * (создаётся при отсутствии); группа — ровно в неё (повтор вкладки по рецепту).
     */
    readonly group?: "beside" | EditorGroup;
    /** Каретка и скролл новой вкладки (у уже открытой вкладки не трогаются). */
    readonly viewState?: ITextEditorViewState;
    /**
     * Открыть вкладкой-ПРЕДПРОСМОТРА: такая вкладка в группе одна, и следующее
     * превью занимает её слот. Просят только те двери, где эталон тоже превьюит
     * (дерево Explorer); остальные открывают постоянную вкладку. Гасится
     * настройкой `workbench.editor.enablePreview`.
     */
    readonly preview?: boolean;
}

/** Событие изменения полосы групп (для view-слоя и host-адаптеров). */
export interface IGroupsChangeEvent {
    readonly kind: "added" | "removed" | "moved";
    readonly group: EditorGroup;
    /** Позиция группы в полосе (для added/moved — новая). */
    readonly index: number;
    /** Группа-источник сплита (view-слой делит её долю пополам). */
    readonly source?: EditorGroup;
}

/**
 * Короткая причина отказа — для лога и для сообщения человеку. Стек здесь не
 * нужен (в тост он не влезет, а виноватого называет сама схема ресурса), но
 * `String(err)` на Error добавил бы префикс «Error: » — берём сообщение.
 */
function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
        LanguageConfigurationServiceDIToken,
        DialogServiceDIToken,
        EditorPaneFactoriesDIToken,
        LanguageFeaturesServiceDIToken,
        IFileServiceDIToken,
        TextFileModelServiceDIToken,
        TextEditorPaneBuilderDIToken,
    ] as const;

    /**
     * Полоса групп в порядке ViewColumn − 1; без сплитов — ровно одна.
     * Вкладочные операции (позиция, `activateTab`, MRU) — у самой группы
     * ({@link activeGroup}), фасада на сервисе нет.
     */
    private groupsList: EditorGroup[] = [];
    private activeGroupValue!: EditorGroup;
    /** Монотонный счётчик стабильных id групп (не переиспользуется). */
    private groupIdCounter = 0;
    /** Владение группой и подписками на её события; чистится при схлопывании. */
    private readonly groupSubscriptions = new Map<GroupId, IDisposable[]>();
    /**
     * Редакторы вне таб-строки (нижняя Panel: Output). Держим отдельным списком
     * именно затем, чтобы весь код вкладок — `getEditors`, `editorCount`,
     * `getOpenFilePaths`, `collectDirty` — продолжал ходить по группам и
     * не знал о них вовсе. Виден detached-редактор ровно в одном месте:
     * {@link getActivePane}, когда фокус внутри него.
     */
    private detachedPanes: TextEditorPane[] = [];
    private themeService: ThemeService;
    private languageService: ILanguageService;
    private configurationService: IConfigurationService;
    /**
     * `editor.*`-настройки текстовых поверхностей: новые настраивает сервис,
     * стороны диффа — `openDiffPair`, Alt+Z — команда `toggleWordWrap`.
     */
    public readonly editorConfiguration: TextEditorConfiguration;
    private undoRedoService: UndoRedoService;
    private readonly logger: ILogger;
    /**
     * Фабрики вкладок по видам: через рецепт вкладки сплит и копия в группу
     * повторяют вкладку, не зная её вида (см. {@link IEditorPaneFactory}).
     */
    private readonly paneFactories: readonly IEditorPaneFactory<unknown>[];
    /** Закрытие вкладок с подтверждением (см. {@link closeEditor}). */
    private readonly closeHandler: EditorCloseHandler;
    private readonly onActiveEditorChangedEmitter = new Emitter<TextEditorPane | null>();
    private readonly onEditorSavedEmitter = new Emitter<IEditorSavedMeta>();
    private readonly onDidChangeEditorsEmitter = new Emitter<void>();
    // Форвардинг выделения перевешивается на каждой смене активного редактора
    // ({@link fireActiveEditorChanged}), поэтому подписчику, пришедшему позже
    // openFile, отдельно подцеплять текущий редактор не нужно.
    private readonly onDidChangeActiveEditorSelectionEmitter = new Emitter<TextEditorPane>();
    /** Подписка на выделение активного редактора; перевешивается при его смене. */
    private activeSelectionSubscription?: IDisposable;
    private saveParticipantValue?: SaveParticipant;
    /** Модели файлов и безымянных буферов, пайплайн сохранения. */
    public readonly textFileModels: TextFileModelService;
    /** Сборка вью текстовой вкладки поверх модели. */
    private readonly paneBuilder: TextEditorPaneBuilder;

    private readonly onDidActiveGroupChangeEmitter = new Emitter<EditorGroup>();
    private readonly onDidGroupsChangeEmitter = new Emitter<IGroupsChangeEvent>();
    private readonly onDidChangeMruCycleEmitter = new Emitter<MruCycleState | null>();

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

    /**
     * Источник содержимого недисковых ресурсов (host подключает сюда
     * `workspace.registerTextDocumentContentProvider` расширений). Читается
     * самим сервисом в {@link openUri}: без источника `jdt:`/`class:`-ресурс
     * открыть нечем.
     */
    public virtualDocumentSource: IVirtualDocumentSource = NULL_VIRTUAL_DOCUMENT_SOURCE;

    private readonly onDidFailOpenEmitter = new Emitter<{ readonly uri: Uri; readonly reason: string }>();
    /**
     * Событие «ресурс открыть не удалось» — композиция вешает на него показ
     * сообщения человеку. Своей зависимости от `NotificationService` у сервиса нет
     * намеренно: показывать сообщения — не его работа, а вот знать, что
     * открытие провалилось, кроме него не может никто.
     *
     * Молчать здесь нельзя: Go to Definition в библиотеку без установленного
     * провайдера иначе выглядит как «клавиша не работает».
     */
    public readonly onDidFailOpen = this.onDidFailOpenEmitter.event;

    /**
     * Save-участник расширений (host/харнесс подключает сюда
     * `onWillSaveTextDocument`). Модели читают его через провайдер пайплайна
     * (`TextFileModelService.addSaveParticipant`) в момент сохранения — присваивание в
     * любой момент видно и уже открытым редакторам, и всем последующим.
     */
    public get saveParticipant(): SaveParticipant | undefined {
        return this.saveParticipantValue;
    }

    public set saveParticipant(participant: SaveParticipant | undefined) {
        this.saveParticipantValue = participant;
    }

    /**
     * Смена курсора/выделения в **активном** редакторе группы. Подписка живёт на
     * уровне группы и сама переезжает на новый активный редактор, так что
     * потребителю (extension host, проецирующий выделение в субпроцесс) не нужно
     * следить за вкладками.
     */
    public readonly onDidChangeActiveEditorSelection = this.onDidChangeActiveEditorSelectionEmitter.event;

    public readonly onActiveEditorChanged = this.onActiveEditorChangedEmitter.event;

    /**
     * Агрегированное событие сохранения любого редактора группы (host мапит его
     * в `workspace.didSaveTextDocument`). Отдельно от per-document
     * `onDidSaveDocument`, на который подписаны вкладки.
     */
    public readonly onEditorSaved = this.onEditorSavedEmitter.event;

    /**
     * Любое изменение, требующее пересинхронизации группового view: список
     * вкладок, их метки/маркеры изменённости, активная вкладка, view активного
     * редактора. Подписчик — `EditorGroupComponent` (перерисовывает tab strip
     * и вставляет контент). Файрится ДО {@link onActiveEditorChanged}, чтобы к
     * моменту листенеров (и фокуса) view активного редактора уже стоял в дереве.
     */
    public readonly onDidChangeEditors = this.onDidChangeEditorsEmitter.event;

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
        // Опционален с NULL-дефолтом, как параметр EditorComponent: два десятка
        // тестовых конструкторов сервиса живут без авто-закрытия скобок.
        languageConfigurationService: ILanguageConfigurationService = NULL_LANGUAGE_CONFIGURATION_SERVICE,
        // Без хоста диалог не покажется: закрытие грязной вкладки в таком
        // сервисе громко упадёт, а не потеряет правки молча.
        dialogService: DialogService = new DialogService(),
        // Фабрики вкладок из contrib (Keyboard Shortcuts, дифф); текстовая —
        // своя, сервису она и так известна.
        contributedPaneFactories: readonly IEditorPaneFactory<unknown>[] = [],
        // Реестры языковых провайдеров (on-save участники спрашивают их по
        // документу). Дефолт — пустые: тестовым конструкторам без провайдеров
        // он не нужен.
        languageFeatures: ILanguageFeaturesService = new LanguageFeaturesService(),
        // Запись моделей (save / saveAs). Дефолт — сервис без провайдеров:
        // тестовым конструкторам, которые не сохраняют, диск не нужен, а
        // сохранение в таком сервисе громко падает, а не пишет мимо.
        files?: IFileService,
        // Модели и сборка вкладок: в композиции — из DI, тестовым
        // конструкторам хватает собранных из параметров выше.
        textFileModels?: TextFileModelService,
        paneBuilder?: TextEditorPaneBuilder,
    ) {
        super();
        const fileService = files ?? this.register(new FileService());
        this.textFileModels =
            textFileModels ??
            this.register(new TextFileModelService(languageService, undoRedoService, fileService, fileWatcher));
        this.paneBuilder =
            paneBuilder ??
            new TextEditorPaneBuilder(
                tokenizationRegistry,
                tokenStyleResolver,
                languageConfigurationService,
                languageFeatures,
                contextMenuController,
            );
        this.themeService = themeService;
        this.languageService = languageService;
        this.configurationService = configurationService;
        this.undoRedoService = undoRedoService;
        // Stryker disable next-line StringLiteral,ObjectLiteral: имя канала и его метка — подпись в селекторе Output, поведения логирования не задают
        this.logger = logService.createLogger("workbench.editorGroups", { label: "Editor Groups" });
        this.paneFactories = [createTextEditorPaneFactory(this), ...contributedPaneFactories];
        this.closeHandler = new EditorCloseHandler(dialogService, {
            surfaces: () => [...this.textPanes(), ...this.diffSidePanes()],
        });
        // Участники сохранения по настройкам (`editor.codeActionsOnSave` /
        // `editor.formatOnSave`): провайдеров берут из реестров по документу.
        const onSaveHost: IOnSaveParticipantHost = {
            configuration: configurationService,
            languageFeatures,
            paneForUri: (uri) => this.textPanes().find((pane) => pane.uri.toString() === uri) ?? null,
        };
        // Пайплайн сохранения собирается В МОМЕНТ save по живым настройкам
        // (порядок VS Code: code actions → формат → will-save расширений; правки
        // каждого ложатся в буфер до следующего и до записи на диск). С
        // дефолтами (обе настройки выключены) остаётся один will-save участник,
        // без host'а — ни одного, и save идёт без участников. Участник по
        // провайдерам входит, только если для ЭТОГО документа есть подходящий
        // провайдер (реестр по селектору).
        const codeActionsOnSave = createCodeActionsOnSaveParticipant(onSaveHost);
        const formatOnSave = createFormatOnSaveParticipant(onSaveHost);
        this.register(
            this.textFileModels.addSaveParticipant((model) =>
                // Отсев — экономия прохода: участник сам проверяет провайдер и
                // виды (onSaveParticipants.ts) и без них — no-op.
                // Stryker disable next-line ConditionalExpression,LogicalOperator: эквивалентен — см. выше
                languageFeatures.codeActionProvider.has(model) &&
                // Stryker disable next-line EqualityOperator,ConditionalExpression: участник без включённых видов — no-op (провайдера не зовёт), а запись и так асинхронная; отсев только экономит проход
                enabledCodeActionKindsOnSave(configurationService, model.languageId).length > 0
                    ? codeActionsOnSave
                    : null,
            ),
        );
        this.register(
            this.textFileModels.addSaveParticipant((model) =>
                // То же у формата: участник сам читает `editor.formatOnSave`, а
                // без форматтера formatDocument отдаёт null — no-op.
                // Stryker disable next-line ConditionalExpression,LogicalOperator: эквивалентен — см. выше
                hasDocumentFormatter(languageFeatures, model) &&
                configurationService.get("editor.formatOnSave", { overrideIdentifier: model.languageId })
                    ? formatOnSave
                    : null,
            ),
        );
        this.register(this.textFileModels.addSaveParticipant(() => this.saveParticipantValue ?? null));
        // Сохранение модели: метки/маркеры вкладок и агрегат для host'а.
        this.register(
            this.textFileModels.onDidSaveModel((model) => {
                this.fireEditorsChanged();
                this.fireModelSaved(model);
            }),
        );
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
        // Стороны диффа — тоже редактирующие поверхности: tabSize и прочие
        // editor.* обязаны доехать и до них.
        this.editorConfiguration = this.register(
            new TextEditorConfiguration(this.configurationService, () => [
                ...this.textPanes(),
                ...this.diffSidePanes(),
            ]),
        );
        // Сменился язык документа — настройки редактора читаются для нового
        // языка (`"[lang]"`-секции). Переприменяем ко всем, как при правке
        // настроек: остальным это ничего не меняет.
        this.register(
            this.textFileModels.onDidChangeModelLanguage(() => {
                this.editorConfiguration.reapply();
            }),
        );
        // Выключили предпросмотр — висящие превью прикалываем, иначе следующее
        // открытие заместило бы вкладку при выключенной настройке (эталон
        // делает то же в onDidChangeEditorPartOptions).
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration(PREVIEW_SETTING_KEY) || this.isPreviewEnabled()) return;
                for (const group of this.groupsList) {
                    const preview = group.previewPane;
                    if (preview !== null) group.pinPane(preview);
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
    public readonly onDidActiveGroupChange = this.onDidActiveGroupChangeEmitter.event;

    /**
     * Жизнь серии Ctrl+Tab любой группы полосы (практически — активной: цикл
     * запускают команды через фасад): снимок замороженного MRU-списка с позицией
     * цикла на каждом шаге и `null`, когда серия кончилась. Подписчик — оверлей
     * переключателя вкладок ({@link import("../../../browser/parts/editor/tabSwitcherComponent.ts").TabSwitcherComponent}).
     */
    public readonly onDidChangeMruCycle = this.onDidChangeMruCycleEmitter.event;

    /** Структурное изменение полосы: группа добавлена/удалена/переставлена. */
    public readonly onDidGroupsChange = this.onDidGroupsChangeEmitter.event;

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

        // Сплит — заявка «этот файл мне нужен»: вкладку-источник прикалываем,
        // чтобы следующее превью не заместило половину сплита (эталон так же).
        source.pinPane(sourcePane);

        // Дубль активной вкладки — по её рецепту (каретка и скролл — как в
        // источнике, US-1). Вкладку, которую повторить нельзя (untitled), новая
        // группа не получает и остаётся пустой.
        this.activeGroupValue = group;
        const recipe = this.describePane(sourcePane);
        if (recipe !== undefined) void recipe.factory.open(recipe.descriptor, { group, focus });
        if (group.editorCount === 0) {
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
    public moveActiveEditorToGroup(direction: "next" | "previous", { focus = true }: { focus?: boolean } = {}): void {
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
     * Копия активной вкладки в соседнюю группу (US-17) — по её рецепту: общий
     * документ через реестр, каретка/скролл скопированы. Вкладку, которую
     * повторить нельзя (untitled), не копируем вовсе. Ресурс уже в целевой —
     * просто активируется там.
     */
    public copyActiveEditorToGroup(direction: "next" | "previous", { focus = true }: { focus?: boolean } = {}): void {
        const source = this.activeGroupValue;
        const sourcePane = source.activePane;
        // Мутант условия эквивалентен: у пустой группы рецепта нет и так —
        // `describe` всех фабрик на не-панели отдаёт `undefined`.
        // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
        if (sourcePane === null) return;
        const recipe = this.describePane(sourcePane);
        if (recipe === undefined) return;
        const target = this.neighborOrNewGroup(direction);
        if (target === null) return;

        // Как и у сплита: копия вкладки в соседнюю группу прикалывает источник.
        source.pinPane(sourcePane);
        this.activeGroupValue = target;
        void recipe.factory.open(recipe.descriptor, { group: target, focus });
        this.fireActiveGroupChanged(target);
    }

    /**
     * Рецепт вкладки для сплита/копии; `undefined` — повторить вкладку нельзя
     * (рецепта нет либо вкладка одна на окно).
     */
    private describePane(pane: IEditorPane): { factory: IEditorPaneFactory<unknown>; descriptor: unknown } | undefined {
        const recipe = this.recipeOf(pane);
        return recipe?.factory.singleton === true ? undefined : recipe;
    }

    /** Рецепт вкладки у фабрики её вида. */
    private recipeOf(pane: IEditorPane): { factory: IEditorPaneFactory<unknown>; descriptor: unknown } | undefined {
        for (const factory of this.paneFactories) {
            const descriptor = factory.describe(pane);
            if (descriptor !== undefined) return { factory, descriptor };
        }
        return undefined;
    }

    /** Вкладка → запись сессии; `undefined` — вкладка рестарт не переживает. */
    public serializeEditor(pane: IEditorPane): ISerializedEditor | undefined {
        const recipe = this.recipeOf(pane);
        if (recipe === undefined) return undefined;
        const value = recipe.factory.serialize(recipe.descriptor);
        return value === undefined ? undefined : { typeId: recipe.factory.typeId, value };
    }

    /**
     * Запись сессии → рецепт у фабрики её вида; `undefined` — фабрики такого
     * вида нет (сборка новее/старее) или повторить вкладку уже нельзя: такие
     * записи молча выпадают, как у upstream.
     */
    public deserializeEditor(
        entry: ISerializedEditor,
    ): { factory: IEditorPaneFactory<unknown>; descriptor: unknown } | undefined {
        const factory = this.paneFactories.find((candidate) => candidate.typeId === entry.typeId);
        if (factory === undefined) return undefined;
        const descriptor = factory.deserialize(entry.value);
        return descriptor === undefined ? undefined : { factory, descriptor };
    }

    /** Открыть вкладку по записи сессии (см. {@link deserializeEditor}) в группу. */
    public openSerializedEditor(entry: ISerializedEditor, target: { group: EditorGroup; focus: boolean }): void {
        const recipe = this.deserializeEditor(entry);
        if (recipe !== undefined) void recipe.factory.open(recipe.descriptor, target);
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
        // Уход фокуса в другую группу завершает идущую серию Ctrl+Tab прежней:
        // выбранная в серии вкладка фиксируется в MRU, оверлей переключателя
        // получает `null` и гаснет.
        this.activeGroupValue.endMruCycle();
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
            group.onDidChangeMruCycle((state) => {
                this.fireMruCycleChanged(state);
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
        this.onDidActiveGroupChangeEmitter.fire(group);
    }

    private fireMruCycleChanged(state: MruCycleState | null): void {
        this.onDidChangeMruCycleEmitter.fire(state);
    }

    private fireGroupsChanged(event: IGroupsChangeEvent): void {
        this.onDidGroupsChangeEmitter.fire(event);
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
            if (active?.getAncestorPath().includes(pane.view) === true) return pane;
        }
        return null;
    }

    /**
     * Открывает готовую панель не-текстового вида (дифф и т.п.) — в активную
     * группу либо в указанную (рестор сессии). Идентичность — по ресурсу в
     * пределах группы, как и у файлов: повторный вызов переключает на
     * существующую вкладку, а не заводит вторую.
     */
    public openPane(
        pane: IEditorPane,
        { focus = true, group = this.activeGroupValue }: { focus?: boolean; group?: EditorGroup } = {},
    ): void {
        const existingIndex = group.findPaneIndex(pane.uri);
        if (existingIndex >= 0) {
            pane.dispose();
            group.activateTab(existingIndex, { focus });
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
        // Активная сторона диффа v2 — редактирующая поверхность вкладки: Ctrl+S,
        // Save As и editor-options расширений обязаны работать по ней, а не
        // онеметь на «не-текстовой» вкладке.
        if (pane instanceof DiffEditorPane2) return pane.activeTextPane;
        return pane instanceof TextEditorPane ? pane : null;
    }

    /**
     * Создаёт редактор ВНЕ таб-строки: он не попадает ни в `getPanes`, ни в
     * персист сессии, ни в shutdown-протокол — те ходят по `this.panes`.
     * Ресурс синтетический (`output:<channel>`), содержимое даёт владелец через
     * `TextEditorPane.model`. Владелец же и решает, куда вставить `pane.view`.
     */
    public openDetached(uri: Uri, languageId: string): TextEditorPane<SyntheticTextModel> {
        // Синтетический ресурс уникален по построению — модель мимо реестра; ни
        // диска, ни сохранения — файловой обвязки ей не нужно.
        const model = new SyntheticTextModel(this.languageService, this.undoRedoService, uri, languageId);
        const editor = this.paneBuilder.build(model);
        editor.detached = true;
        // Вкладочные панели обвязывает группа; detached — сам сервис.
        this.wirePane(editor);
        this.editorConfiguration.apply(editor);
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
            const existing = this.replaceVirtualContent(group, existingIndex, text);
            /* v8 ignore start -- defensive: снимок по этому uri открывает только этот метод, вид панели известен */
            // Stryker disable next-line ConditionalExpression: недостижимая ветвь по той же причине, что и для покрытия — панель по этому ресурсу заводит только этот метод
            if (existing !== null) {
                /* v8 ignore stop */
                group.activateTab(existingIndex, { focus });
                return existing;
            }
        }

        const editor = this.createVirtualPane(uri, text, { languageId, label });
        group.insertPane(editor);
        group.activateTab(group.editorCount - 1, { focus });
        return editor;
    }

    /** Открытые текстовые редакторы ВСЕХ групп — без панелей других видов. */
    public getEditors(): readonly TextEditorPane[] {
        return this.textPanes();
    }

    /** Текстовые вкладки всех групп в порядке полосы (декорации, конфиг, персист). */
    private textPanes(): TextEditorPane[] {
        return this.allPanes().filter((pane): pane is TextEditorPane => pane instanceof TextEditorPane);
    }

    /** Стороны всех дифф-вкладок v2 — редактирующие поверхности вне таб-строки. */
    private diffSidePanes(): TextEditorPane[] {
        return this.allPanes().flatMap((pane) => (pane instanceof DiffEditorPane2 ? [...pane.sidePanes()] : []));
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
    public openFile(filePath: string, options: IOpenUriOptions = {}): void {
        void this.openUri(Uri.file(path.resolve(filePath)), options);
    }

    /**
     * Открывает ресурс по uri — вход для тех, у кого он уже есть (диагностики,
     * Go to Definition, `window.showTextDocument`). `group: "beside"` — открытие
     * в соседней справа группе (Open to the Side, Go to Definition to the Side);
     * соседки нет — она создаётся (при нехватке места — фолбэк в активную, с
     * записью в лог).
     *
     * **Обещание НИКОГДА не отклоняется.** Это не гигиена, а требование: почти
     * все вызывающие — команды, которые роняют промис в `void`, а необработанный
     * отказ в главном процессе убивает редактор целиком (именно так F12 в
     * `jdt:`-ресурс уносил весь редактор). Любая неудача открытия уезжает в лог
     * и в {@link onDidFailOpen}, но наружу отказом не выходит.
     *
     * Асинхронен ровно один случай — **впервые открываемый недисковый ресурс**:
     * за его содержимым надо сходить к провайдеру схемы. Всё остальное — файл с
     * диска и активация уже открытой вкладки — делается до первого `await`,
     * поэтому навигация (Go Back, клик по маркеру) работает как раньше.
     */
    public openUri(uri: Uri, options: IOpenUriOptions = {}): Promise<void> {
        // Ресурсы не с диска идут своей дорогой: там нет ни чтения файла, ни
        // watcher'а, ни записи — только текст от провайдера схемы.
        if (uri.scheme === "file" || this.isOpenInTargetGroup(uri, options.group)) {
            this.openResolvedUri(uri, null, options);
            return Promise.resolve();
        }
        return this.openVirtualUri(uri, options);
    }

    /**
     * Открывает ресурс, содержимое которого уже известно: `null` — файл с диска
     * (модель берётся из реестра) либо уже открытая вкладка, строка — свежий
     * недисковый ресурс (синтетическая read-only модель). Общая часть — выбор
     * группы и пер-группный дедуп.
     */
    private openResolvedUri(
        uri: Uri,
        content: string | null,
        { focus = true, group: where, viewState, preview = false }: IOpenUriOptions,
    ): void {
        // Идентичность вкладки — по ресурсу целиком В ПРЕДЕЛАХ группы, а не по
        // имени файла: два разных файла с одинаковым basename должны открываться
        // в отдельных вкладках, а тот же ресурс в другой группе — своей вкладкой
        // (общая модель через реестр).
        const group = where === "beside" ? this.resolveBesideGroup() : (where ?? this.activeGroupValue);
        const wasActive = group === this.activeGroupValue;
        this.activeGroupValue = group;
        // Превью включает только вызывающий (сейчас — дерево Explorer) и только
        // при включённой настройке: все прочие двери (CLI, Quick Open, навигация
        // по коду, восстановление сессии) открывают постоянную вкладку, как в
        // эталоне с его выключенными enablePreviewFrom*.
        const asPreview = preview && this.isPreviewEnabled();
        const existingIndex = group.findPaneIndex(uri);
        if (existingIndex >= 0) {
            // Повторное открытие уже открытого ресурса НЕ превью прикалывает его
            // вкладку: Ctrl+P по файлу, висящему предпросмотром, обязан оставить
            // его открытым (эталон делает то же в doOpenEditor).
            // Индекс пришёл из `findPaneIndex` — он в границах по построению,
            // поэтому берём панель прямо, без защиты от `null`.
            if (!asPreview) group.pinPane(group.getPanes()[existingIndex]);
            group.activateTab(existingIndex, { focus });
        } else {
            // Модель файла приходит из реестра уже загруженной (фабрика ставит
            // watcher до openFile); вкладка владеет ссылкой, а не самой моделью.
            let editor: TextEditorPane;
            if (content !== null) {
                editor = this.createVirtualPane(uri, content);
            } else {
                const ref = this.textFileModels.acquire(uri);
                editor = this.paneBuilder.build(ref.model, ref);
                this.editorConfiguration.apply(editor);
            }
            // Прямое присваивание, без reveal: позиция пришла из вкладки, где
            // она и так была видима.
            if (viewState !== undefined) {
                editor.viewState.selections = [...viewState.selections];
                editor.viewState.scrollTop = viewState.scrollTop;
                editor.viewState.scrollLeft = viewState.scrollLeft;
            }
            // Следующее превью занимает СЛОТ предыдущего: та же позиция в полосе
            // вместо «закрыли → открыли в конце» — иначе поехали бы порядок
            // вкладок и фокус.
            const replacedIndex = asPreview ? this.previewIndexToReplace(group) : -1;
            if (replacedIndex >= 0) {
                group.replacePane(replacedIndex, editor, { preview: true });
                group.activateTab(replacedIndex, { focus });
            } else {
                group.insertPane(editor, { preview: asPreview });
                group.activateTab(group.editorCount - 1, { focus });
            }
        }
        if (!wasActive) this.fireActiveGroupChanged(group);
    }

    /** Включён ли режим предпросмотра (`workbench.editor.enablePreview`). */
    private isPreviewEnabled(): boolean {
        // Ключ из схемы приложения: дефолт (`true`) гарантирует реестр, своего
        // фолбэка тут быть не должно — он разъехался бы со схемой.
        return this.configurationService.get(PREVIEW_SETTING_KEY);
    }

    /**
     * Позиция вкладки-предпросмотра, которую можно заместить, либо -1.
     * Грязную вкладку замещать нельзя — её вместо этого прикалываем: правка
     * (в т.ч. приехавшая извне) делает вкладку постоянной, и потерять её при
     * открытии следующего превью было бы потерей несохранённых правок.
     */
    private previewIndexToReplace(group: EditorGroup): number {
        const preview = group.previewPane;
        if (preview === null) return -1;
        if (preview.isModified) {
            group.pinPane(preview);
            return -1;
        }
        return group.getPanes().indexOf(preview);
    }

    /**
     * Открыт ли ресурс во вкладке той группы, куда его собираются открывать.
     * Проверка **без побочных эффектов** — в отличие от {@link openResolvedUri},
     * она не делает целевую группу активной и не заводит соседнюю: её ответ
     * решает лишь, идти ли к провайдеру, а идти туда за уже открытым ресурсом
     * не надо (в эталоне модель тоже живёт, пока провайдер не сказал
     * `onDidChange`).
     */
    private isOpenInTargetGroup(uri: Uri, where?: "beside" | EditorGroup): boolean {
        const group =
            where === "beside"
                ? this.groupsList.at(this.groupsList.indexOf(this.activeGroupValue) + 1)
                : (where ?? this.activeGroupValue);
        return group !== undefined && group.findPaneIndex(uri) >= 0;
    }

    /**
     * Открывает недисковый ресурс: текст берётся у {@link virtualDocumentSource},
     * а вкладка получается такой же, как у снимка ревизии — синтетическая модель
     * и read-only ({@link openTextSnapshot}).
     *
     * Не открыть такой ресурс — штатный исход, а не сбой ядра: провайдера схемы
     * может не быть вовсе (расширение не установлено или ещё не активировалось),
     * он может отказаться отдать ресурс или сломаться. Во всех трёх случаях
     * человек обязан увидеть, почему ничего не открылось, — молчаливый no-op
     * здесь худший из возможных исходов (см. {@link onDidFailOpen}).
     */
    private async openVirtualUri(uri: Uri, options: IOpenUriOptions): Promise<void> {
        const source = this.virtualDocumentSource;
        if (!source.canProvide(uri.scheme)) {
            this.reportOpenFailed(uri, `no content provider is registered for the "${uri.scheme}:" scheme`);
            return;
        }
        let content: string | null;
        try {
            content = await source.provide(uri);
        } catch (error) {
            this.reportOpenFailed(uri, describeError(error));
            return;
        }
        if (content === null) {
            this.reportOpenFailed(uri, `the "${uri.scheme}:" content provider returned no content`);
            return;
        }
        this.openResolvedUri(uri, content, options);
    }

    /**
     * Сможет ли {@link openUri} открыть этот ресурс (шов истории навигации,
     * см. `IHistoryEditorSource.canRestore`).
     *
     * Диск и безымянный буфер — да. Недисковый — ровно пока его схему кто-то
     * обслуживает: `jdt:`-исходник восстановим, пока жив провайдер расширения,
     * а `output:` и снимочные стороны диффа не восстановимы никогда —
     * их содержимое пишет владелец вкладки, ресурс его не адресует.
     */
    public canRestore(uri: Uri): boolean {
        if (uri.scheme === "file" || uri.scheme === "untitled") return true;
        return this.virtualDocumentSource.canProvide(uri.scheme);
    }

    /**
     * Перечитывает содержимое открытых вкладок недискового ресурса — реакция на
     * `TextDocumentContentProvider.onDidChange`. Ресурса нет среди открытых —
     * ничего не делаем: заводить вкладку по событию провайдера нельзя, человек
     * её не просил.
     *
     * Ничего не ждём и наружу не отдаём: это фоновое освежение, и отказ
     * провайдера здесь — повод написать в лог, а не показывать сообщение
     * поверх работы (вкладка просто остаётся с прежним текстом).
     */
    public refreshVirtualDocument(uri: Uri): void {
        const key = uri.toString();
        // Вкладка недискового ресурса — текстовая и синтетическая по построению;
        // обе проверки сужают тип, отличить их поведением нечем.
        // Stryker disable next-line MethodExpression: эквивалентен — см. выше
        const textPanes = this.allPanes().filter(isTextEditorPane);
        const targets = textPanes.flatMap((pane) =>
            pane.uri.toString() === key &&
            // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
            pane.model instanceof SyntheticTextModel
                ? [pane.model]
                : [],
        );
        if (targets.length === 0) return;
        // `.catch` ХВОСТОМ, а не вторым аргументом `then`: так он накрывает и
        // отказ провайдера, и поломку самой заливки текста. Иначе исключение из
        // обработчика успеха улетело бы необработанным отказом — а это ровно тот
        // класс, ради которого здесь всё и затевалось.
        void this.virtualDocumentSource
            .provide(uri)
            .then((content) => {
                if (content === null) return;
                for (const model of targets) model.replaceContent(content);
            })
            .catch((error: unknown) => {
                this.logger.error(`cannot refresh ${uri.toString()}: ${describeError(error)}`);
            });
    }

    /**
     * Вкладка недискового ресурса: синтетическая модель (ни диска, ни watcher'а,
     * ни save) с содержимым от провайдера и замком read-only. Язык выводим из
     * «пути» ресурса — у `jdt://contents/…/StringUtils.java` он честный.
     */
    private createVirtualPane(
        uri: Uri,
        content: string,
        overrides: { languageId?: string; label?: string } = {},
    ): TextEditorPane {
        // Синтетический ресурс уникален по построению — модель мимо реестра.
        const languageId = overrides.languageId ?? this.languageService.getLanguageIdForResource(uri.path);
        const model = new SyntheticTextModel(
            this.languageService,
            this.undoRedoService,
            uri,
            languageId ?? "plaintext",
        );
        model.replaceContent(content);
        const editor = this.paneBuilder.build(model);
        editor.labelOverride = overrides.label ?? path.basename(uri.path);
        this.editorConfiguration.apply(editor);
        editor.readOnly = true;
        return editor;
    }

    /**
     * Переливает свежее содержимое в уже открытую вкладку недискового ресурса.
     * Возвращает её же; `null` — на этой позиции панель другого вида (открывать
     * заново такую позицию нельзя, решает вызывающий).
     */
    private replaceVirtualContent(group: EditorGroup, index: number, content: string): TextEditorPane | null {
        const pane = group.getPane(index);
        /* v8 ignore start -- defensive: вкладку по этому ресурсу заводит только createVirtualPane */
        // Stryker disable next-line ConditionalExpression,LogicalOperator: недостижимая ветвь по той же причине, что и для покрытия
        if (!(pane instanceof TextEditorPane) || !(pane.model instanceof SyntheticTextModel)) return null;
        /* v8 ignore stop */
        pane.model.replaceContent(content);
        return pane;
    }

    /** Сообщает человеку и логу, что ресурс открыть не удалось. */
    private reportOpenFailed(uri: Uri, reason: string): void {
        this.logger.error(`cannot open ${uri.toString()}: ${reason}`);
        this.onDidFailOpenEmitter.fire({ uri, reason });
    }

    /** Группа справа от активной; нет — создаётся (нет места — фолбэк в активную). */
    private resolveBesideGroup(): EditorGroup {
        const index = this.groupsList.indexOf(this.activeGroupValue);
        const next = this.groupsList.at(index + 1);
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
        const model = this.textFileModels.createUntitledModel();
        const editor = this.paneBuilder.build(model);
        // Файл не грузим (view-state из конструктора не пересоздаётся) — конфиг
        // применяем сразу.
        this.editorConfiguration.apply(editor);
        const group = this.activeGroupValue;
        group.insertPane(editor);
        group.activateTab(group.editorCount - 1, { focus });
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

    /**
     * Вкладки ВСЕХ групп для пикера открытых редакторов: активная группа первой
     * (её активная вкладка — во главе списка), за ней остальные в порядке
     * полосы; внутри группы — MRU-порядок ({@link EditorGroup.getMruPanes}).
     * Глобального MRU-стека у нас нет — он живёт на группе, — и склейка по
     * полосе от активной группы даёт ровно то, что пикер обещает заголовком:
     * сверху то, где пользователь только что был.
     */
    public getOpenEditorsMru(): IEditorPane[] {
        const active = this.activeGroupValue;
        const strip = [active, ...this.groupsList.filter((group) => group !== active)];
        return strip.flatMap((group) => group.getMruPanes());
    }

    /**
     * Показывает уже открытую вкладку: делает её группу активной и активирует
     * саму вкладку с фокусом (пикер открытых редакторов). Панель не из полосы
     * (detached-редактор, уже закрытая вкладка) — no-op.
     */
    public revealPane(pane: IEditorPane): void {
        const group = this.groupOf(pane);
        if (group === null) return;
        this.makeGroupActive(group);
        group.activateTab(group.getPanes().indexOf(pane));
    }

    /**
     * Шаг по вкладкам в ВИЗУАЛЬНОМ порядке (VS Code `nextEditor` /
     * `previousEditor`, Ctrl+PgDn/PgUp): вкладки всех групп слева направо, с
     * заворотом на краях полосы. В отличие от MRU-цикла Ctrl+Tab здесь нет
     * hold-сессии — каждый шаг сразу коммитится (обычный `activateTab` сам
     * двигает цель в начало MRU). У пустой активной группы «вперёд» начинает с
     * первой вкладки полосы, «назад» — с последней.
     */
    public cycleEditor(direction: 1 | -1): void {
        const entries: { group: EditorGroup; index: number }[] = [];
        for (const group of this.groupsList) {
            for (let index = 0; index < group.editorCount; index++) entries.push({ group, index });
        }
        if (entries.length < 2) return;

        const active = this.activeGroupValue;
        const current = entries.findIndex((entry) => entry.group === active && entry.index === active.activeIndex);
        const base = current >= 0 ? current + direction : direction === 1 ? 0 : -1;
        const target = entries[((base % entries.length) + entries.length) % entries.length];

        if (target.group === active) {
            active.activateTab(target.index);
            return;
        }
        // Переход через границу группы: цель становится активной группой (тот же
        // порядок, что у moveActiveTabToGroup — сначала группа, потом вкладка).
        // Идущую серию Ctrl+Tab источника завершаем как при любом уходе из группы.
        active.endMruCycle();
        this.activeGroupValue = target.group;
        target.group.activateTab(target.index);
        this.fireActiveGroupChanged(target.group);
    }

    public async activate(): Promise<void> {
        // Пока нечего активировать: async-инициализация редакторов (LSP и т.п.) —
        // будущий шов сервисного слоя.
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
        const seenModels = new Set<BaseTextEditorModel>();
        // Стороны диффа — после вкладок: у вкладки метка красивее, а модель
        // у них общая, так что дифф добавляет только СВОИ dirty-буферы
        // (untitled-стороны, файл без обычной вкладки).
        for (const editor of [...this.textPanes(), ...this.diffSidePanes()]) {
            if (!editor.isModified) continue;
            if (seenModels.has(editor.model)) continue;
            seenModels.add(editor.model);
            items.push({
                name: this.displayName(editor),
                isStillDirty: () =>
                    [...this.textPanes(), ...this.diffSidePanes()].some((pane) => pane.model === editor.model),
                save: async () => (await editor.save({ overwrite: true })) === "saved",
            });
        }
        return items;
    }

    /**
     * Нужен ли confirm-диалог перед закрытием вкладки — единая формула для всех
     * путей закрытия (см. {@link EditorCloseHandler.needsCloseConfirm}).
     */
    public needsCloseConfirm(pane: IEditorPane): boolean {
        return this.closeHandler.needsCloseConfirm(pane);
    }

    /**
     * Стороны диффа с несохранёнными правками, которые не показаны больше нигде
     * (см. {@link EditorCloseHandler.dirtyExclusiveDiffSides}).
     */
    public dirtyExclusiveDiffSides(pane: DiffEditorPane2): TextEditorPane[] {
        return this.closeHandler.dirtyExclusiveDiffSides(pane);
    }

    /**
     * Закрывает вкладку группы — панель или её позицию — с confirm-диалогом,
     * если закрытие потеряет несохранённые правки (аналог upstream
     * `IEditorGroup.closeEditor`). `false` — пользователь отменил или Save не
     * удался, вкладка осталась. Позиция вне полосы — закрывать нечего, `true`.
     */
    public closeEditor(group: EditorGroup, target: IEditorPane | number): Promise<boolean> {
        const pane = typeof target === "number" ? group.getPane(target) : target;
        if (pane === null) return Promise.resolve(true);
        return this.closeEditors(group, [pane]);
    }

    /**
     * Последовательно закрывает `panes` группы в заданном порядке (он же порядок
     * диалогов); первое вето обрывает серию. `true` — закрыты все.
     */
    public closeEditors(group: EditorGroup, panes: readonly IEditorPane[]): Promise<boolean> {
        return this.closeHandler.confirmAndClose(group, panes);
    }

    /**
     * Закрывает группу целиком — с хвоста, как Ctrl+K W: диалоги по
     * несохранённым идут справа налево, а Cancel прерывает серию.
     */
    public closeAllEditors(group: EditorGroup): Promise<boolean> {
        return this.closeEditors(group, [...group.getPanes()].reverse());
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
        this.onDidChangeEditorsEmitter.fire();
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
        this.onActiveEditorChangedEmitter.fire(editor);
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
            this.onDidChangeActiveEditorSelectionEmitter.fire(editor);
        });
    }

    private fireModelSaved(model: TextFileModel): void {
        // Ресурс есть у любого редактора — гейт на "путь не задан" больше не нужен.
        const meta: IEditorSavedMeta = { uri: model.uri.toString(), languageId: model.languageId };
        this.onEditorSavedEmitter.fire(meta);
    }
}
