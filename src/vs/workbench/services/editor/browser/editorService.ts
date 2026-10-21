import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable, toDisposable } from "../../../../base/common/lifecycle.ts";
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
import type { SaveOutcome, TextFileModel } from "../../textfile/common/textFileModel.ts";
import { TextFileModelService, TextFileModelServiceDIToken } from "../../textfile/common/textFileModelService.ts";
import type { ThemeService } from "../../themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../themes/common/themeTokens.ts";
import type { IEditorGroupsService } from "../common/editorGroupsService.ts";
import { EditorGroupsServiceDIToken } from "../common/editorGroupsService.ts";
import type { IEditorSavedMeta, IEditorService, IOpenUriOptions, IUntitledOptions } from "../common/editorService.ts";
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

const PREVIEW_SETTING_KEY = "workbench.editor.enablePreview";

const CLOSE_ON_FILE_DELETE_SETTING_KEY = "workbench.editor.closeOnFileDelete";

/** Не `String(error)`: на Error тот добавил бы префикс «Error: ». */
function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Без reveal: позиция пришла из вкладки, где и так была видима. */
function applyViewState(editor: TextEditorPane, viewState: ITextEditorViewState): void {
    editor.viewState.selections = [...viewState.selections];
    editor.viewState.scrollTop = viewState.scrollTop;
    editor.viewState.scrollLeft = viewState.scrollLeft;
}

/** `null` — перенос ресурс не задел (эталон: `isEqualOrParent` + `joinPath` в `EditorService.handleMovedFile`). */
export function movedResource(resource: Uri, source: Uri, target: Uri): Uri | null {
    // Пути сравнимы только в одной схеме: у безымянного буфера «путь» относительный.
    if (resource.scheme !== source.scheme) return null;
    const relative = path.relative(source.fsPath, resource.fsPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return Uri.file(path.join(target.fsPath, relative));
}

function holdsFocus(view: IEditorPane["view"]): boolean {
    // Stryker disable next-line OptionalChaining: у корня смонтированного дерева FocusManager есть всегда, у несмонтированной вкладки `getRoot()` и так `null`
    const active = view.getRoot()?.focusManager?.activeElement ?? null;
    return active?.getAncestorPath().includes(view) === true;
}

/** Аналог upstream `EditorService`. Про `EditorGroupComponent` не знает: тот сам подписан на свою группу. */
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

    public readonly editorGroups: IEditorGroupsService;
    /** Редакторы вне таб-строки (Output): код вкладок о них не знает, виден detached только в {@link getActivePane}. */
    private detachedPanes: TextEditorPane[] = [];
    private themeService: ThemeService;
    private languageService: ILanguageService;
    private configurationService: IConfigurationService;
    public readonly editorConfiguration: TextEditorConfiguration;
    private undoRedoService: UndoRedoService;
    private readonly logger: ILogger;
    private readonly paneFactories: readonly IEditorPaneFactory<unknown>[];
    private readonly closeHandler: EditorCloseHandler;
    private readonly onActiveEditorChangedEmitter = new Emitter<TextEditorPane | null>();
    private readonly onEditorSavedEmitter = new Emitter<IEditorSavedMeta>();
    private readonly onDidChangeEditorsEmitter = new Emitter<void>();
    private readonly onDidChangeActiveEditorSelectionEmitter = new Emitter<TextEditorPane>();
    private activeSelectionSubscription?: IDisposable;
    private saveParticipantValue?: SaveParticipant;
    public readonly textFileModels: TextFileModelService;
    private readonly paneBuilder: TextEditorPaneBuilder;

    public virtualDocumentSource: IVirtualDocumentSource = NULL_VIRTUAL_DOCUMENT_SOURCE;

    private readonly onDidFailOpenEmitter = new Emitter<{ readonly uri: Uri; readonly reason: string }>();
    /**
     * Зависимости от `NotificationService` нет намеренно: показ сообщения — работа композиции. Молчать
     * нельзя: Go to Definition в библиотеку без провайдера иначе выглядит как «клавиша не работает».
     */
    public readonly onDidFailOpen = this.onDidFailOpenEmitter.event;

    /** Сервис владеет моделью, пока первое {@link openUri} не заберёт её во вкладку. */
    private readonly untitledWithoutEditor = new Map<string, TextFileModel>();

    /** Читается в момент сохранения: присваивание видно и уже открытым редакторам. */
    public get saveParticipant(): SaveParticipant | undefined {
        return this.saveParticipantValue;
    }

    public set saveParticipant(participant: SaveParticipant | undefined) {
        this.saveParticipantValue = participant;
    }

    /** Подписка сама переезжает на новый активный редактор: следить за вкладками потребителю не нужно. */
    public readonly onDidChangeActiveEditorSelection = this.onDidChangeActiveEditorSelectionEmitter.event;

    public readonly onActiveEditorChanged = this.onActiveEditorChangedEmitter.event;

    public readonly onEditorSaved = this.onEditorSavedEmitter.event;

    /** Файрится ДО {@link onActiveEditorChanged}: к листенерам (и фокусу) view активного редактора уже в дереве. */
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
        languageConfigurationService: ILanguageConfigurationService = NULL_LANGUAGE_CONFIGURATION_SERVICE,
        // Без хоста закрытие грязной вкладки громко упадёт, а не потеряет правки молча.
        dialogService: DialogService = new DialogService(),
        contributedPaneFactories: readonly IEditorPaneFactory<unknown>[] = [],
        languageFeatures: ILanguageFeaturesService = new LanguageFeaturesService(),
        // Дефолт без провайдеров: сохранение громко падает, а не пишет мимо.
        files?: IFileService,
        textFileModels?: TextFileModelService,
        paneBuilder?: TextEditorPaneBuilder,
        editorGroups?: IEditorGroupsService,
    ) {
        super();
        this.register(
            toDisposable(() => {
                for (const model of this.untitledWithoutEditor.values()) model.dispose();
                this.untitledWithoutEditor.clear();
            }),
        );
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
        const onSaveHost: IOnSaveParticipantHost = {
            configuration: configurationService,
            languageFeatures,
            paneForUri: (uri) => this.textPanes().find((pane) => pane.uri.toString() === uri) ?? null,
        };
        // Пайплайн собирается в момент save по живым настройкам; порядок VS Code:
        // code actions → формат → will-save расширений.
        const codeActionsOnSave = createCodeActionsOnSaveParticipant(onSaveHost);
        const formatOnSave = createFormatOnSaveParticipant(onSaveHost);
        this.register(
            this.textFileModels.addSaveParticipant((model) =>
                // Отсев — экономия прохода: без провайдера и видов участник и так no-op.
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
                // То же у формата: без форматтера formatDocument отдаёт null — no-op.
                // Stryker disable next-line ConditionalExpression,LogicalOperator: эквивалентен — см. выше
                hasDocumentFormatter(languageFeatures, model) &&
                configurationService.get("editor.formatOnSave", { overrideIdentifier: model.languageId })
                    ? formatOnSave
                    : null,
            ),
        );
        this.register(this.textFileModels.addSaveParticipant(() => this.saveParticipantValue ?? null));
        this.register(
            this.textFileModels.onDidSaveModel((model) => {
                this.fireEditorsChanged();
                this.fireModelSaved(model);
            }),
        );
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
        // Стороны диффа — тоже редактирующие поверхности: editor.* обязаны доехать и до них.
        this.editorConfiguration = this.register(
            new TextEditorConfiguration(this.configurationService, () => [
                ...this.textPanes(),
                ...this.diffSidePanes(),
            ]),
        );
        // Новый язык — другие `"[lang]"`-секции настроек.
        this.register(
            this.textFileModels.onDidChangeModelLanguage(() => {
                this.editorConfiguration.reapply();
            }),
        );
        // Вкладки едут за перенесённым файлом (эталон `onDidRunFileOperation` → `handleMovedFile`):
        // иначе первое сохранение воскрешало файл по старому пути.
        this.register(
            fileService.onDidRunOperation((event) => {
                // Stryker disable next-line ConditionalExpression: у Move сервис кладёт `target` всегда — проверка лишь сужает тип
                if (event.operation === FileOperation.Move && event.target !== undefined) {
                    this.handleMovedFile(event.resource, event.target);
                }
                if (event.operation === FileOperation.Delete) this.handleDeletedFile(event.resource);
            }),
        );
        // Удалён снаружи: при `closeOnFileDelete` чистые вкладки уходят (эталон
        // `handleDeletedFile(…, isExternal: true)`), иначе остаются зачёркнутыми.
        this.register(
            this.textFileModels.onDidChangeModelOrphaned((model) => {
                if (!model.isOrphaned) return;
                if (!this.configurationService.get(CLOSE_ON_FILE_DELETE_SETTING_KEY)) return;
                this.closeCleanEditors((pane) => pane.fileModel === model);
            }),
        );
        // Выключили предпросмотр — висящие превью прикалываем, иначе следующее открытие
        // заместило бы вкладку (эталон: onDidChangeEditorPartOptions).
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

    /** Вкладку, которую повторить нельзя (untitled), новая группа не получает и остаётся пустой. */
    public splitActiveGroup({
        focus = true,
        position,
    }: { focus?: boolean; position?: "before" | "after" } = {}): EditorGroup | null {
        const source = this.editorGroups.activeGroup;
        return this.editorGroups.splitActiveGroup(
            (group, sourcePane) => {
                // Сплит — заявка «этот файл мне нужен»: источник прикалываем, чтобы следующее
                // превью не заместило половину сплита (эталон так же).
                source.pinPane(sourcePane);
                const recipe = this.describePane(sourcePane);
                if (recipe !== undefined) void recipe.factory.open(recipe.descriptor, { group, focus });
            },
            { focus, position },
        );
    }

    /** Вкладку, которую повторить нельзя (untitled), не копируем вовсе. */
    public copyActiveEditorToGroup(direction: "next" | "previous", { focus = true }: { focus?: boolean } = {}): void {
        const source = this.editorGroups.activeGroup;
        const sourcePane = source.activePane;
        // Мутант эквивалентен: у пустой группы рецепта нет и так.
        // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
        if (sourcePane === null) return;
        const recipe = this.describePane(sourcePane);
        if (recipe === undefined) return;
        this.editorGroups.openInNeighborGroup(direction, (target) => {
            source.pinPane(sourcePane);
            void recipe.factory.open(recipe.descriptor, { group: target, focus });
        });
    }

    private describePane(pane: IEditorPane): { factory: IEditorPaneFactory<unknown>; descriptor: unknown } | undefined {
        const recipe = this.recipeOf(pane);
        return recipe?.factory.singleton === true ? undefined : recipe;
    }

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

    /** `undefined` — вида нет (сборка новее/старее) или повторить нельзя: такие записи молча выпадают, как у upstream. */
    public deserializeEditor(
        entry: ISerializedEditor,
    ): { factory: IEditorPaneFactory<unknown>; descriptor: unknown } | undefined {
        const factory = this.paneFactories.find((candidate) => candidate.typeId === entry.typeId);
        if (factory === undefined) return undefined;
        const descriptor = factory.deserialize(entry.value);
        return descriptor === undefined ? undefined : { factory, descriptor };
    }

    public openSerializedEditor(entry: ISerializedEditor, target: { group: EditorGroup; focus: boolean }): void {
        const recipe = this.deserializeEditor(entry);
        if (recipe !== undefined) void recipe.factory.open(recipe.descriptor, target);
    }

    /**
     * Вкладка замещается, а не переименовывается на месте: держатели ресурса по uri (документы
     * расширений, маркеры, quick diff) видят честные «закрыли — открыли», как в эталоне.
     * Стороны дифф-вкладок не трогаем — их ресурсы фиксирует владелец диффа.
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
                // Файл в двух группах — одна модель: вторая заливка того же текста ничего не меняет.
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
            // Замещение событий не шлёт: перерисовку и смену активного даёт повторная активация.
            if (moved) group.activateTab(group.activeIndex, { focus: focusActive });
        }
    }

    /**
     * Чистые вкладки закрываются независимо от `closeOnFileDelete` (эталон `isExternal: false`);
     * грязная остаётся и зачеркнётся, когда watcher сделает модель orphaned.
     */
    public handleDeletedFile(resource: Uri): void {
        // Перенос «на себя» не-`null` ровно для ресурса, равного `resource` или лежащего под ним.
        this.closeCleanEditors((pane) => movedResource(pane.uri, resource, resource) !== null);
    }

    /** Стороны диффа не трогаем — их ресурсы фиксирует владелец диффа. */
    private closeCleanEditors(matches: (pane: TextEditorPane) => boolean): void {
        // Копия списка: опустевшая группа уходит из полосы прямо в цикле.
        for (const group of [...this.editorGroups.groups]) {
            const panes = group
                .getPanes()
                .filter((pane): pane is TextEditorPane => pane instanceof TextEditorPane)
                .filter((pane) => pane.fileModel !== null && !pane.isModified && matches(pane));
            // Чистые вкладки подтверждения не спрашивают — закрытие синхронно.
            void this.closeEditors(group, panes);
        }
    }

    /**
     * Фокус внутри detached-панели (Output) делает активной её: иначе стрелки и Ctrl+F шли бы
     * в файл за панелью. Аналог `ICodeEditorService.getFocusedCodeEditor()`.
     */
    public getActivePane(): IEditorPane | null {
        const focused = this.focusedDetachedPane();
        if (focused !== null) return focused;
        return this.getActiveTabPane();
    }

    /**
     * Без detached-панелей: нужна тем, кто вставляет контент в область редактора, уводит фокус
     * ИЗ панели и показывает расширениям `activeTextEditor` (фокус в панели его не подменяет, как в VS Code).
     */
    public getActiveTabPane(): IEditorPane | null {
        return this.editorGroups.activeGroup.activePane;
    }

    private focusedDetachedPane(): TextEditorPane | null {
        if (this.detachedPanes.length === 0) return null;
        return this.detachedPanes.find((pane) => holdsFocus(pane.view)) ?? null;
    }

    /** Ресурс уже открыт в группе — переключает на ту вкладку, а переданную `pane` освобождает. */
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

    /** `null` и на панели другого вида: потребители текста молча ничего не делают на диффе. */
    public getActiveEditor(): TextEditorPane | null {
        const pane = this.getActivePane();
        // Стороны диффа — настоящие текстовые панели: молчаливый null онемел бы всю вкладку
        // (резолвнувшаяся команда съедает клавишу).
        if (pane instanceof DiffEditorPane2) return pane.activeTextPane;
        return pane instanceof TextEditorPane ? pane : null;
    }

    /** Уже {@link getActiveEditor}: так дифф ходит кареткой тем же кодом, что и редактор, оставаясь read-only. */
    public getActiveViewState(): EditorViewState | null {
        return this.getActivePane()?.viewState ?? null;
    }

    public getActiveTabEditor(): TextEditorPane | null {
        const pane = this.getActiveTabPane();
        // Активная сторона диффа: Ctrl+S, Save As и editor-options расширений работают по ней.
        if (pane instanceof DiffEditorPane2) return pane.activeTextPane;
        return pane instanceof TextEditorPane ? pane : null;
    }

    /** Вне таб-строки: ни в `getPanes`, ни в персисте сессии, ни в shutdown. Куда вставить `pane.view`, решает владелец. */
    public openDetached(uri: Uri, languageId: string): TextEditorPane<SyntheticTextModel> {
        // Синтетический ресурс уникален по построению — модель мимо реестра.
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
     * Read-only вкладка с контентом от вызывающего (файл на ревизии из `git:`): ни watcher'а, ни save,
     * ни персиста. Повторный вызов с тем же uri обновляет содержимое — ветка могла сдвинуться.
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

    public getEditors(): readonly TextEditorPane[] {
        return this.textPanes();
    }

    public getTextSurfaces(): readonly TextEditorPane[] {
        return [...this.textPanes(), ...this.diffSidePanes()];
    }

    public getUntitledModelsWithoutEditor(): readonly TextFileModel[] {
        return [...this.untitledWithoutEditor.values()];
    }

    private textPanes(): TextEditorPane[] {
        return this.allPanes().filter((pane): pane is TextEditorPane => pane instanceof TextEditorPane);
    }

    private diffSidePanes(): TextEditorPane[] {
        return this.allPanes().flatMap((pane) => (pane instanceof DiffEditorPane2 ? [...pane.sidePanes()] : []));
    }

    private allPanes(): IEditorPane[] {
        return this.editorGroups.groups.flatMap((group) => [...group.getPanes()]);
    }

    public getOpenFilePaths(): string[] {
        const paths: string[] = [];
        for (const editor of this.textPanes()) {
            if (editor.absoluteFilePath !== null) paths.push(editor.absoluteFilePath);
        }
        return paths;
    }

    /** `path.resolve` вплотную перед `Uri.file`: тот относительный путь не резолвит, а префиксует слэшем. */
    public openFile(filePath: string, options: IOpenUriOptions = {}): void {
        void this.openUri(Uri.file(path.resolve(filePath)), options);
    }

    /**
     * **Обещание никогда не отклоняется**: вызывающие роняют его в `void`, а необработанный отказ
     * убивает редактор (так F12 в `jdt:`-ресурс уносил его целиком) — неудачи уходят в лог и
     * {@link onDidFailOpen}. Асинхронен только впервые открываемый недисковый ресурс: файл с диска и
     * уже открытая вкладка открываются до первого `await`.
     */
    public openUri(uri: Uri, options: IOpenUriOptions = {}): Promise<void> {
        if (uri.scheme === "file" || this.isOpenInTargetGroup(uri, options.group)) {
            this.openResolvedUri(uri, null, options);
            return Promise.resolve();
        }
        const untitled = this.untitledWithoutEditor.get(uri.toString());
        if (untitled !== undefined) {
            this.openUntitledWithoutEditor(untitled, options);
            return Promise.resolve();
        }
        return this.openVirtualUri(uri, options);
    }

    /** `content`: `null` — файл с диска или уже открытая вкладка, строка — свежий недисковый ресурс. */
    private openResolvedUri(
        uri: Uri,
        content: string | null,
        { focus = true, group: where, viewState, preview = false }: IOpenUriOptions,
    ): void {
        // Идентичность — по ресурсу целиком в пределах группы, а не по basename.
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
        // Превью — только по просьбе вызывающего (дерево Explorer) и при включённой настройке,
        // как в эталоне с выключенными enablePreviewFrom*.
        const asPreview = preview && this.isPreviewEnabled();
        const existingIndex = group.findPaneIndex(uri);
        if (existingIndex >= 0) {
            // Повторное не-превью открытие прикалывает вкладку (эталон: doOpenEditor).
            if (!asPreview) group.pinPane(group.getPanes()[existingIndex]);
            group.activateTab(existingIndex, { focus });
        } else {
            // Вкладка владеет ссылкой на модель, а не самой моделью.
            let editor: TextEditorPane;
            if (content !== null) {
                editor = this.createVirtualPane(uri, content);
            } else {
                const ref = this.textFileModels.acquire(uri);
                editor = this.paneBuilder.build(ref.model, ref);
                this.editorConfiguration.apply(editor);
            }
            if (viewState !== undefined) applyViewState(editor, viewState);
            // Новое превью занимает слот предыдущего, иначе поехали бы порядок вкладок и фокус.
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

    private isPreviewEnabled(): boolean {
        // Без своего фолбэка: дефолт гарантирует схема, иначе разъедется с ней.
        return this.configurationService.get(PREVIEW_SETTING_KEY);
    }

    /** Грязное превью не замещаем, а прикалываем: иначе потеряли бы несохранённые правки. */
    private previewIndexToReplace(group: EditorGroup): number {
        const preview = group.previewPane;
        if (preview === null) return -1;
        if (preview.isModified) {
            group.pinPane(preview);
            return -1;
        }
        return group.getPanes().indexOf(preview);
    }

    /** Без побочных эффектов, в отличие от {@link openResolvedUri}: не активирует группу и не заводит соседнюю. */
    private isOpenInTargetGroup(uri: Uri, where?: "beside" | EditorGroup): boolean {
        const group =
            where === "beside"
                ? this.editorGroups.groups.at(this.editorGroups.groups.indexOf(this.editorGroups.activeGroup) + 1)
                : (where ?? this.editorGroups.activeGroup);
        return group !== undefined && group.findPaneIndex(uri) >= 0;
    }

    /**
     * Провайдера схемы может не быть, он может отказать или сломаться — во всех случаях человек
     * обязан увидеть, почему ничего не открылось ({@link onDidFailOpen}).
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

    /** `output:` и снимочные стороны диффа не восстановимы: их содержимое пишет владелец вкладки, ресурс его не адресует. */
    public canRestore(uri: Uri): boolean {
        if (uri.scheme === "file" || uri.scheme === "untitled") return true;
        return this.virtualDocumentSource.canProvide(uri.scheme);
    }

    /** Неоткрытый ресурс вкладку не заводит — человек её не просил. Отказ провайдера — только в лог: освежение фоновое. */
    public refreshVirtualDocument(uri: Uri): void {
        const key = uri.toString();
        // Вкладка недискового ресурса текстовая и синтетическая по построению: проверки лишь сужают тип.
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
        // `.catch` хвостом, а не вторым аргументом `then`: накрывает и поломку заливки текста.
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

    /** Язык — из «пути» ресурса: у `jdt://contents/…/StringUtils.java` он честный. */
    private createVirtualPane(
        uri: Uri,
        content: string,
        overrides: { languageId?: string; label?: string } = {},
    ): TextEditorPane {
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

    /** `null` — на этой позиции панель другого вида. */
    private replaceVirtualContent(group: EditorGroup, index: number, content: string): TextEditorPane | null {
        const pane = group.getPane(index);
        /* v8 ignore start -- defensive: вкладку по этому ресурсу заводит только createVirtualPane */
        // Stryker disable next-line ConditionalExpression,LogicalOperator: недостижимая ветвь по той же причине, что и для покрытия
        if (!(pane instanceof TextEditorPane) || !(pane.model instanceof SyntheticTextModel)) return null;
        /* v8 ignore stop */
        pane.model.replaceContent(content);
        return pane;
    }

    private reportOpenFailed(uri: Uri, reason: string): void {
        this.logger.error(`cannot open ${uri.toString()}: ${reason}`);
        this.onDidFailOpenEmitter.fire({ uri, reason });
    }

    public newUntitled({ focus = true }: { focus?: boolean } = {}): void {
        const model = this.textFileModels.createUntitledModel();
        const editor = this.paneBuilder.build(model);
        this.editorConfiguration.apply(editor);
        const group = this.editorGroups.activeGroup;
        group.insertPane(editor);
        group.activateTab(group.editorCount - 1, { focus });
    }

    /**
     * `workspace.openTextDocument({ content })` (`$tryCreateDocument` эталона): документ сразу открыт
     * расширениям, вкладку заводит `showTextDocument` через {@link openUri}. Непустой текст — грязный буфер.
     */
    public createUntitled({ content, languageId, encoding }: IUntitledOptions = {}): Uri {
        const model = this.textFileModels.createUntitledModel();
        if (languageId !== undefined) model.setLanguage(languageId);
        // Stryker disable next-line ConditionalExpression: эквивалентен — неизвестную (и отсутствующую) кодировку setEncoding и так пропускает
        if (encoding !== undefined) model.setEncoding(encoding);
        // Пустой текст — не правка: буфер остаётся чистым (`!!initialValue` эталона).
        if (content !== undefined && content !== "") model.restoreUnsavedContents(content);
        this.untitledWithoutEditor.set(model.uri.toString(), model);
        this.fireEditorsChanged();
        return model.uri;
    }

    /** Владение моделью переходит к вкладке. */
    private openUntitledWithoutEditor(model: TextFileModel, { focus = true, group: where }: IOpenUriOptions): void {
        this.untitledWithoutEditor.delete(model.uri.toString());
        const editor = this.paneBuilder.build(model);
        this.editorConfiguration.apply(editor);
        const group = where === "beside" ? this.editorGroups.sideGroup() : (where ?? this.editorGroups.activeGroup);
        this.editorGroups.openInGroup(group, () => {
            group.insertPane(editor);
            group.activateTab(group.editorCount - 1, { focus });
        });
    }

    /** Только для панелей вне таб-строки: вкладочные обвязывает сама группа в `insertPane`. */
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

    /** Фокус вкладки (не панели), любого вида: дифф тоже получает ввод. */
    public focusEditor(): void {
        this.getActiveTabPane()?.focusEditor();
    }

    /**
     * `isStillDirty` ловит вкладки, закрытые, пока человек отвечал на предыдущие диалоги. Save при выходе
     * перезаписывает файл даже при внешних изменениях — выбор человека не должен пропасть.
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
     * `saveAll` эталона. Безымянный буфер пропускается (Save As посреди запуска задачи не открываем),
     * изменённый на диске файл не перезаписывается. С `includeUntitled` эталон спрашивает путь диалогом;
     * у нас его нет, и оставшийся безымянный буфер — честный `false`.
     */
    public async saveAll(options?: { includeUntitled?: boolean }): Promise<boolean> {
        let success = true;
        for (const editor of this.dirtyEditors()) {
            const outcome = await this.trySave(editor);
            if (outcome === "saved" || (outcome === "no-file" && options?.includeUntitled !== true)) continue;
            success = false;
        }
        return success;
    }

    /** `$save` эталона без Save As: пишется и чистый буфер (`force`). */
    public async save(resource: Uri): Promise<Uri | undefined> {
        const key = resource.toString();
        const editor = this.getTextSurfaces().find((pane) => pane.uri.toString() === key);
        if (editor === undefined) return undefined;
        return (await this.trySave(editor)) === "saved" ? editor.uri : undefined;
    }

    private async trySave(editor: TextEditorPane): Promise<SaveOutcome | undefined> {
        try {
            return await editor.save();
        } catch (error) {
            this.logger.error(`cannot save ${editor.uri.toString()}: ${describeError(error)}`);
            return undefined;
        }
    }

    /**
     * По одному на модель. Стороны диффа — после вкладок: у вкладки метка красивее, а дифф добавляет
     * только свои буферы (untitled-стороны, файл без обычной вкладки).
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

    public needsCloseConfirm(pane: IEditorPane): boolean {
        return this.closeHandler.needsCloseConfirm(pane);
    }

    public dirtyExclusiveDiffSides(pane: DiffEditorPane2): TextEditorPane[] {
        return this.closeHandler.dirtyExclusiveDiffSides(pane);
    }

    /** `false` — человек отменил или Save не удался. Позиция вне полосы — закрывать нечего, `true`. */
    public closeEditor(group: EditorGroup, target: IEditorPane | number): Promise<boolean> {
        const pane = typeof target === "number" ? group.getPane(target) : target;
        if (pane === null) return Promise.resolve(true);
        return this.closeEditors(group, [pane]);
    }

    /** Порядок `panes` — порядок диалогов; первое вето обрывает серию. */
    public closeEditors(group: EditorGroup, panes: readonly IEditorPane[]): Promise<boolean> {
        return this.closeHandler.confirmAndClose(group, panes);
    }

    /** С хвоста, как Ctrl+K W: диалоги идут справа налево, Cancel прерывает серию. */
    public closeAllEditors(group: EditorGroup): Promise<boolean> {
        return this.closeEditors(group, [...group.getPanes()].reverse());
    }

    public displayName(editor: IEditorPane): string {
        return editor.label;
    }

    /** Расширение — из текущего языка буфера: сменили язык — предложение едет следом. */
    public suggestedSaveName(editor: TextEditorPane): string {
        const name = this.displayName(editor);
        const extension = this.languageService.getExtensionForLanguage(editor.languageId);
        return extension === undefined ? name : `${name}${extension}`;
    }

    private fireEditorsChanged(): void {
        this.onDidChangeEditorsEmitter.fire();
    }

    /** Наружу — только текстовая панель: для потребителей текста дифф — «нет активного редактора». */
    private fireActiveEditorChanged(pane: IEditorPane | null): void {
        const editor = pane instanceof TextEditorPane ? pane : null;
        this.rebindActiveSelectionForwarding(editor);
        this.onActiveEditorChangedEmitter.fire(editor);
    }

    /** Слушателей {@link onDidChangeActiveEditorSelection} не дёргаем: смену видно через {@link onActiveEditorChanged}. */
    private rebindActiveSelectionForwarding(editor: TextEditorPane | null): void {
        this.activeSelectionSubscription?.dispose();
        this.activeSelectionSubscription = undefined;
        if (editor === null) return;
        this.activeSelectionSubscription = editor.onDidChangeSelection(() => {
            this.onDidChangeActiveEditorSelectionEmitter.fire(editor);
        });
    }

    private fireModelSaved(model: TextFileModel): void {
        const meta: IEditorSavedMeta = { uri: model.uri.toString(), languageId: model.languageId };
        this.onEditorSavedEmitter.fire(meta);
    }
}
