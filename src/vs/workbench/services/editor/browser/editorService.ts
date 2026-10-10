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
import { FileOperation, type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
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
import type { IEditorGroupsService } from "../common/editorGroupsService.ts";
import { EditorGroupsServiceDIToken } from "../common/editorGroupsService.ts";
import type { IEditorSavedMeta, IEditorService, IOpenUriOptions } from "../common/editorService.ts";
import type { IVirtualDocumentSource } from "../common/iVirtualDocumentSource.ts";
import { NULL_VIRTUAL_DOCUMENT_SOURCE } from "../common/iVirtualDocumentSource.ts";

import { EditorCloseHandler } from "./editorCloseHandler.ts";
import type { EditorGroup } from "./editorGroupModel.ts";
import { EditorGroupsService } from "./editorGroupsService.ts";
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

/** Настройка режима предпросмотра вкладок (`workbenchConfiguration`). */
const PREVIEW_SETTING_KEY = "workbench.editor.enablePreview";

/**
 * Короткая причина отказа — для лога и для сообщения человеку. Стек здесь не
 * нужен (в тост он не влезет, а виноватого называет сама схема ресурса), но
 * `String(err)` на Error добавил бы префикс «Error: » — берём сообщение.
 */
function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Позиция вкладки — прямым присваиванием, без reveal: она пришла из вкладки,
 * где и так была видима.
 */
function applyViewState(editor: TextEditorPane, viewState: ITextEditorViewState): void {
    editor.viewState.selections = [...viewState.selections];
    editor.viewState.scrollTop = viewState.scrollTop;
    editor.viewState.scrollLeft = viewState.scrollLeft;
}

/**
 * Куда уехал ресурс при переносе `source` → `target`: сам файл — на `target`,
 * файл внутри перенесённого каталога — на тот же относительный путь под
 * `target`; `null` — перенос ресурс не задел (эталон: `isEqualOrParent` +
 * `joinPath` в `EditorService.handleMovedFile`).
 */
export function movedResource(resource: Uri, source: Uri, target: Uri): Uri | null {
    // Пути сравнимы только в одной схеме: у безымянного буфера «путь»
    // относительный, у чужой схемы — свой, совпадение путей ничего не значит.
    if (resource.scheme !== source.scheme) return null;
    const relative = path.relative(source.fsPath, resource.fsPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    // Сам ресурс (`relative === ""`) — `join` отдаёт ровно `target`.
    return Uri.file(path.join(target.fsPath, relative));
}

/** Внутри ли `view` сейчас фокус — по пути от активного элемента вверх. */
function holdsFocus(view: IEditorPane["view"]): boolean {
    // Stryker disable next-line OptionalChaining: у корня смонтированного дерева FocusManager есть всегда, у несмонтированной вкладки `getRoot()` и так `null`
    const active = view.getRoot()?.focusManager?.activeElement ?? null;
    return active?.getAncestorPath().includes(view) === true;
}

/**
 * «Редакторы» воркбенча без view — реализация {@link IEditorService} (аналог
 * upstream `EditorService`): активный редактор, все редакторы, открытие и
 * закрытие ресурсов поверх полосы групп ({@link IEditorGroupsService}).
 * Модели — `TextFileModelService`, сборка вью вкладки — `TextEditorPaneBuilder`,
 * `editor.*`-настройки — `TextEditorConfiguration`. Про групповой контрол
 * (`EditorGroupComponent`) не знает — тот подписан на свою группу и сам
 * вставляет view активного редактора и перерисовывает табы.
 */
export class EditorService extends Disposable implements IEditorService, IShutdownParticipant, IActivatable {
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
        EditorGroupsServiceDIToken,
    ] as const;

    /**
     * Полоса групп (аналог upstream `IEditorGroupsService`): группы, активная
     * группа, сплиты и перенос вкладок. Вкладочные операции — у самой группы.
     */
    public readonly editorGroups: IEditorGroupsService;
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
        editorGroups?: IEditorGroupsService,
    ) {
        super();
        this.editorGroups = editorGroups ?? this.register(new EditorGroupsService(logService));
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
        // События полосы → события «редакторов»: вкладки/метки любой группы и
        // смена активной вкладки полосы (сужение до текста — здесь).
        this.register(
            this.editorGroups.onDidChangeEditors(() => {
                this.fireEditorsChanged();
            }),
        );
        this.register(
            this.editorGroups.onDidChangeActivePane((pane) => {
                this.fireActiveEditorChanged(pane);
            }),
        );
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
        // Перенос файла или каталога через файловый сервис (rename/move
        // проводника, их отмена, файловые операции `workspace.applyEdit`) —
        // вкладки едут за ним. Эталон: `EditorService.onDidRunFileOperation` →
        // `handleMovedFile`. Без этого вкладка оставалась на старом пути, и
        // первое же сохранение воскрешало переименованный файл.
        this.register(
            fileService.onDidRunOperation((event) => {
                // Stryker disable next-line ConditionalExpression: у Move сервис кладёт `target` всегда — проверка лишь сужает тип
                if (event.operation === FileOperation.Move && event.target !== undefined) {
                    this.handleMovedFile(event.resource, event.target);
                }
            }),
        );
        // Выключили предпросмотр — висящие превью прикалываем, иначе следующее
        // открытие заместило бы вкладку при выключенной настройке (эталон
        // делает то же в onDidChangeEditorPartOptions).
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration(PREVIEW_SETTING_KEY) || this.isPreviewEnabled()) return;
                for (const group of this.editorGroups.groups) {
                    const preview = group.previewPane;
                    if (preview !== null) group.pinPane(preview);
                }
            }),
        );
    }

    // ─── Сплит и копия: дубль вкладки по рецепту ──────────────────────────────

    /**
     * Сплит: новая группа рядом с активной с дублем её активной вкладки (общий
     * документ через реестр моделей; каретка и скролл скопированы) — VS Code
     * `workbench.action.splitEditor`. Вкладку, которую повторить нельзя
     * (untitled), новая группа не получает и остаётся пустой. Отказ (пустая
     * активная группа, нет места) и порядок событий — у
     * {@link EditorGroupsService.splitActiveGroup}.
     */
    public splitActiveGroup({
        focus = true,
        position,
    }: { focus?: boolean; position?: "before" | "after" } = {}): EditorGroup | null {
        const source = this.editorGroups.activeGroup;
        return this.editorGroups.splitActiveGroup(
            (group, sourcePane) => {
                // Сплит — заявка «этот файл мне нужен»: вкладку-источник прикалываем,
                // чтобы следующее превью не заместило половину сплита (эталон так же).
                source.pinPane(sourcePane);
                // Дубль активной вкладки — по её рецепту (каретка и скролл — как в
                // источнике, US-1).
                const recipe = this.describePane(sourcePane);
                if (recipe !== undefined) void recipe.factory.open(recipe.descriptor, { group, focus });
            },
            { focus, position },
        );
    }

    /**
     * Копия активной вкладки в соседнюю группу (US-17) — по её рецепту: общий
     * документ через реестр, каретка/скролл скопированы. Вкладку, которую
     * повторить нельзя (untitled), не копируем вовсе. Ресурс уже в целевой —
     * просто активируется там.
     */
    public copyActiveEditorToGroup(direction: "next" | "previous", { focus = true }: { focus?: boolean } = {}): void {
        const source = this.editorGroups.activeGroup;
        const sourcePane = source.activePane;
        // Мутант условия эквивалентен: у пустой группы рецепта нет и так —
        // `describe` всех фабрик на не-панели отдаёт `undefined`.
        // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
        if (sourcePane === null) return;
        const recipe = this.describePane(sourcePane);
        if (recipe === undefined) return;
        this.editorGroups.openInNeighborGroup(direction, (target) => {
            // Как и у сплита: копия вкладки в соседнюю группу прикалывает источник.
            source.pinPane(sourcePane);
            void recipe.factory.open(recipe.descriptor, { group: target, focus });
        });
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

    // ─── Перенос файла: вкладки едут за ним ──────────────────────────────────

    /**
     * Файл (или каталог) перенесли — каждая файловая вкладка, чей ресурс равен
     * `source` или лежит под ним, замещается на том же месте вкладкой нового
     * пути (VS Code `EditorService.handleMovedFile`): позиция в полосе,
     * предпросмотр, активность, каретка и скролл — прежние, фокус остаётся,
     * где был. Несохранённые правки переезжают в модель нового пути, а та
     * остаётся изменённой (`TextFileEditorModelManager` эталона на MOVE).
     *
     * Вкладка именно замещается, а не переименовывается на месте: всё, что
     * держит ресурс по uri (документы расширений, маркеры, quick diff), видит
     * честные «закрыли старый — открыли новый», как в эталоне. Стороны
     * дифф-вкладок не трогаем — их ресурсы фиксирует владелец диффа.
     */
    private handleMovedFile(source: Uri, target: Uri): void {
        for (const group of this.editorGroups.groups) {
            let moved = false;
            let focusActive = false;
            for (const [index, pane] of [...group.getPanes()].entries()) {
                if (!(pane instanceof TextEditorPane) || pane.fileModel === null) continue;
                const resource = movedResource(pane.uri, source, target);
                if (resource === null) continue;
                const ref = this.textFileModels.acquire(resource);
                // Файл в двух группах — одна модель, и вторая заливка того же
                // текста ничего не меняет (каретки вкладок переживают её).
                if (pane.fileModel.isModified) ref.model.restoreUnsavedContents(pane.fileModel.getText());
                const editor = this.paneBuilder.build(ref.model, ref);
                this.editorConfiguration.apply(editor);
                applyViewState(editor, {
                    selections: pane.viewState.cloneSelections(),
                    scrollTop: pane.viewState.scrollTop,
                    scrollLeft: pane.viewState.scrollLeft,
                });
                // Фокус может держать только активная вкладка: неактивные не смонтированы.
                if (holdsFocus(pane.view)) focusActive = true;
                group.replacePane(index, editor, { preview: !group.isPinned(pane) });
                moved = true;
            }
            // Замещение событий не шлёт: перерисовку полосы и смену активного
            // редактора даёт повторная активация текущей вкладки.
            if (moved) group.activateTab(group.activeIndex, { focus: focusActive });
        }
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
        return this.editorGroups.activeGroup.activePane;
    }

    /**
     * Detached-панель, внутри которой сейчас фокус (или `null`). Проверка — по
     * пути от активного элемента вверх, как `holdsFocus` у виджета терминала.
     */
    private focusedDetachedPane(): TextEditorPane | null {
        if (this.detachedPanes.length === 0) return null;
        return this.detachedPanes.find((pane) => holdsFocus(pane.view)) ?? null;
    }

    /**
     * Открывает готовую панель не-текстового вида (дифф и т.п.) — в активную
     * группу либо в указанную (рестор сессии). Идентичность — по ресурсу в
     * пределах группы, как и у файлов: повторный вызов переключает на
     * существующую вкладку, а не заводит вторую.
     */
    public openPane(
        pane: IEditorPane,
        { focus = true, group = this.editorGroups.activeGroup }: { focus?: boolean; group?: EditorGroup } = {},
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
        const group = this.editorGroups.activeGroup;
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

    public getTextSurfaces(): readonly TextEditorPane[] {
        return [...this.textPanes(), ...this.diffSidePanes()];
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
        return this.editorGroups.groups.flatMap((group) => [...group.getPanes()]);
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
        const group = where === "beside" ? this.editorGroups.sideGroup() : (where ?? this.editorGroups.activeGroup);
        this.editorGroups.openInGroup(group, () => {
            this.openInResolvedGroup(group, uri, content, { focus, viewState, preview });
        });
    }

    private openInResolvedGroup(
        group: EditorGroup,
        uri: Uri,
        content: string | null,
        {
            focus,
            viewState,
            preview,
        }: { focus: boolean; viewState: ITextEditorViewState | undefined; preview: boolean },
    ): void {
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
            if (viewState !== undefined) applyViewState(editor, viewState);
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
                ? this.editorGroups.groups.at(this.editorGroups.groups.indexOf(this.editorGroups.activeGroup) + 1)
                : (where ?? this.editorGroups.activeGroup);
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
        const group = this.editorGroups.activeGroup;
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
        return this.dirtyEditors().map((editor) => ({
            name: this.displayName(editor),
            isStillDirty: () =>
                [...this.textPanes(), ...this.diffSidePanes()].some((pane) => pane.model === editor.model),
            save: async () => (await editor.save({ overwrite: true })) === "saved",
        }));
    }

    /**
     * Сохранить все несохранённые документы (`saveAll` эталона — перед запуском
     * задачи). Безымянный буфер пути не имеет и пропускается (диалог Save As
     * посреди запуска задачи не открываем); файл, изменённый на диске,
     * не перезаписывается — его сохранит человек сам.
     */
    public async saveAll(): Promise<void> {
        for (const editor of this.dirtyEditors()) await editor.save();
    }

    /**
     * Несохранённые редакторы, по одному на модель: документ, открытый в
     * нескольких вкладках, — одни несохранённые правки. Стороны диффа — после
     * вкладок: у вкладки метка красивее, а модель у них общая, так что дифф
     * добавляет только СВОИ dirty-буферы (untitled-стороны, файл без обычной
     * вкладки).
     */
    private dirtyEditors(): TextEditorPane[] {
        const seenModels = new Set<BaseTextEditorModel>();
        const editors: TextEditorPane[] = [];
        for (const editor of [...this.textPanes(), ...this.diffSidePanes()]) {
            if (!editor.isModified || seenModels.has(editor.model)) continue;
            seenModels.add(editor.model);
            editors.push(editor);
        }
        return editors;
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
