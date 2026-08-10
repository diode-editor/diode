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
import { UndoRedoService, UndoRedoServiceDIToken } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IActivatable } from "../../../browser/iActivatable.ts";
import { EditorComponent } from "../../../browser/parts/editor/editorComponent.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import {
    LanguageServiceDIToken,
    TokenizationRegistryDIToken,
    TokenStyleResolverDIToken,
} from "../../../common/coreTokens.ts";
import type { IShutdownDirtyItem, IShutdownParticipant } from "../../lifecycle/browser/lifecycleService.ts";
import type { SaveParticipant } from "../../textfile/common/iSaveParticipant.ts";
import { TextFileModel } from "../../textfile/common/textFileModel.ts";
import { TextFileModelRegistry } from "../../textfile/common/textFileModelRegistry.ts";
import type { ThemeService } from "../../themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../themes/common/themeTokens.ts";

export const EditorServiceDIToken = token<EditorService>("EditorService");

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
    ] as const;

    private panes: IEditorPane[] = [];
    /**
     * Реестр моделей открытых файлов: один {@link TextFileModel} на ресурс при
     * любом числе показывающих его вкладок; вкладка владеет ссылкой, модель
     * умирает с последней. Безымянные и синтетические буферы — мимо реестра.
     */
    private readonly modelRegistry = new TextFileModelRegistry((uri) => this.createFileModel(uri));
    /**
     * Редакторы вне таб-строки (нижняя Panel: Output). Держим отдельным списком
     * именно затем, чтобы весь код вкладок — `getEditors`, `editorCount`,
     * `getOpenFilePaths`, `collectDirty` — продолжал ходить по `this.panes` и
     * не знал о них вовсе. Виден detached-редактор ровно в одном месте:
     * {@link getActivePane}, когда фокус внутри него.
     */
    private detachedPanes: TextEditorPane[] = [];
    private activeIndexValue = -1;

    /**
     * Порядок редакторов от самого недавно использованного к самому давнему
     * (mru[0] — активный/последний). Отдельно от `editors`, который хранит
     * позиционный порядок вкладок в strip'е. Питает MRU-переключение Ctrl+Tab.
     */
    private mruOrder: IEditorPane[] = [];
    /**
     * Идёт ли сейчас серия Ctrl+Tab. Пока серия активна, список MRU заморожен
     * (`mruCycleList`), а выбор не коммитится в начало `mruOrder` — иначе нельзя
     * было бы уйти глубже второй вкладки. Любое обычное переключение или
     * структурное изменение завершает серию.
     */
    private cyclingActive = false;
    private mruCycleList: IEditorPane[] = [];
    private mruCyclePointer = 0;
    private themeService: ThemeService;
    private tokenizationRegistry: TokenizationRegistry;
    private tokenStyleResolver: ITokenStyleResolver;
    private languageService: ILanguageService;
    private configurationService: IConfigurationService;
    private undoRedoService: UndoRedoService;
    private fileWatcher: IFileWatcher;
    private contextMenuController: ContextMenuController;
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

    public onRequestConfirmClose?: (index: number) => void;
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

    public get activeIndex(): number {
        return this.activeIndexValue;
    }

    public get editorCount(): number {
        return this.panes.length;
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
        if (this.activeIndexValue < 0 || this.activeIndexValue >= this.panes.length) return null;
        return this.panes[this.activeIndexValue];
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
        if (index < 0 || index >= this.panes.length) return null;
        return this.panes[index];
    }

    /** Открытые панели в позиционном порядке вкладок (живой снимок для view-синхронизации). */
    public getPanes(): readonly IEditorPane[] {
        return this.panes;
    }

    /**
     * Открывает готовую панель не-текстового вида (дифф и т.п.). Идентичность —
     * по ресурсу, как и у файлов: повторный вызов переключает на существующую
     * вкладку, а не заводит вторую.
     */
    public openPane(pane: IEditorPane, { focus = true }: { focus?: boolean } = {}): void {
        const existingIndex = this.panes.findIndex((p) => p.uri.toString() === pane.uri.toString());
        if (existingIndex >= 0) {
            pane.dispose();
            this.activateTab(existingIndex, { focus });
            return;
        }
        this.wirePane(pane);
        this.panes.push(pane);
        this.activateTab(this.panes.length - 1, { focus });
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
        this.applyConfigurationToEditor(editor);
        this.detachedPanes.push(editor);
        return editor;
    }

    /** Текстовый редактор по позиции вкладки; `null`, если там панель другого вида. */
    public getEditor(index: number): TextEditorPane | null {
        const pane = this.getPane(index);
        return pane instanceof TextEditorPane ? pane : null;
    }

    /** Открытые текстовые редакторы — без панелей других видов. */
    public getEditors(): readonly TextEditorPane[] {
        return this.textPanes();
    }

    private textPanes(): TextEditorPane[] {
        return this.panes.filter((pane): pane is TextEditorPane => pane instanceof TextEditorPane);
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
    public openFile(filePath: string, options: { focus?: boolean } = {}): void {
        this.openUri(Uri.file(path.resolve(filePath)), options);
    }

    /** Открывает ресурс по uri — вход для тех, у кого он уже есть (диагностики). */
    public openUri(uri: Uri, { focus = true }: { focus?: boolean } = {}): void {
        // Идентичность вкладки — по ресурсу целиком, а не по имени файла: два разных
        // файла с одинаковым basename (например, два index.ts из разных папок)
        // должны открываться в отдельных вкладках, а не переключать на первую.
        const existingIndex = this.panes.findIndex((e) => e.uri.toString() === uri.toString());
        if (existingIndex >= 0) {
            this.activateTab(existingIndex, { focus });
            return;
        }

        // Модель приходит из реестра уже загруженной (фабрика ставит watcher до
        // openFile); вкладка владеет ссылкой, а не самой моделью.
        const ref = this.modelRegistry.acquire(uri);
        const editor = this.createPaneForModel(ref.model, ref);
        this.applyConfigurationToEditor(editor);
        this.panes.push(editor);
        this.activateTab(this.panes.length - 1, { focus });
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
        // Номер выдаём до push: пока редактора нет в списке вкладок, его никто не видит.
        editor.setUntitled(++this.untitledCounter);
        this.panes.push(editor);
        this.activateTab(this.panes.length - 1, { focus });
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
        this.wirePane(editor);
        editor.foldingRangeSource = this.foldingRangeSourceValue;
        this.onEditorCreate?.(editor);
        return editor;
    }

    /**
     * Общая для панелей любого вида обвязка: владение временем жизни и
     * перерисовка таб-стрипа по изменению видимого во вкладке.
     *
     * Раньше группа подписывалась на три текстовых события по отдельности
     * (контент, EOL, состояние файла на диске). Теперь панель сводит их в
     * {@link IEditorPane.onDidChangeState} сама — группе незачем знать, что такое
     * EOL и бывает ли у вкладки файл на диске.
     */
    private wirePane(pane: IEditorPane): void {
        this.register(pane);
        this.register(
            pane.onDidChangeState(() => {
                this.fireEditorsChanged();
            }),
        );
    }

    public activateTab(index: number, { focus = true, mru = false }: { focus?: boolean; mru?: boolean } = {}): void {
        if (index < 0 || index >= this.panes.length) return;

        // Обычное переключение завершает серию Ctrl+Tab и коммитит в MRU:
        // сперва — недавно выбранную в серии вкладку, затем целевую.
        if (!mru) {
            if (this.cyclingActive) {
                this.commitActiveToMru();
                this.cyclingActive = false;
            }
            this.moveToMruFront(this.panes[index]);
        }

        this.activeIndexValue = index;

        const editor = this.panes[index];
        // Компонент вставляет view активного редактора и перерисовывает табы —
        // до фокуса: фокусировать можно только элемент, стоящий в дереве.
        this.fireEditorsChanged();
        if (focus) this.focusEditor();
        this.fireActiveEditorChanged(editor);
    }

    /**
     * Переключение вкладок по принципу MRU (Ctrl+Tab / Ctrl+Shift+Tab).
     * `direction === 1` идёт к более давним вкладкам, `-1` — к более недавним.
     * Пока серия нажатий не прервана, порядок MRU заморожен, что позволяет
     * проходить по стеку глубже двух вкладок.
     */
    public cycleMru(direction: 1 | -1): void {
        if (this.panes.length < 2) return;

        if (!this.cyclingActive) {
            this.commitActiveToMru();
            this.mruCycleList = this.mruOrder.filter((e) => this.panes.includes(e));
            this.mruCyclePointer = 0;
            this.cyclingActive = true;
        }

        const length = this.mruCycleList.length;
        /* v8 ignore start -- defensive: cyclingActive is cleared on any structural change, so the frozen list always has ≥2 open editors here */
        if (length < 2) {
            this.cyclingActive = false;
            return;
        }
        /* v8 ignore stop */

        this.mruCyclePointer = (this.mruCyclePointer + direction + length) % length;
        const target = this.mruCycleList[this.mruCyclePointer];
        const targetIndex = this.panes.indexOf(target);
        /* v8 ignore start -- defensive: closing a tab clears cyclingActive, so the frozen target is always still open */
        if (targetIndex < 0) {
            this.cyclingActive = false;
            return;
        }
        /* v8 ignore stop */
        this.activateTab(targetIndex, { mru: true });
    }

    /**
     * Завершает серию Ctrl+Tab (вызывается по отпусканию Ctrl): фиксирует
     * выбранный в серии редактор в начале MRU-стека. Благодаря этому быстрые
     * нажатия Ctrl+Tab с отпусканием Ctrl тумблерят два последних редактора
     * (каждая серия — один шаг), а удержание Ctrl с повторными Tab проходит
     * вглубь стека (серия не завершается, список заморожен).
     */
    public endMruCycle(): void {
        if (!this.cyclingActive) return;
        this.commitActiveToMru();
        this.cyclingActive = false;
    }

    /** Снимок MRU-порядка (mru[0] — самый недавний). Для тестов и диагностики. */
    public getMruOrder(): IEditorPane[] {
        return [...this.mruOrder];
    }

    private moveToMruFront(editor: IEditorPane): void {
        const index = this.mruOrder.indexOf(editor);
        if (index >= 0) this.mruOrder.splice(index, 1);
        this.mruOrder.unshift(editor);
    }

    /** Продвигает активный редактор в начало MRU-стека (фиксирует выбор серии). */
    private commitActiveToMru(): void {
        const current = this.getActivePane();
        /* v8 ignore start -- defensive: коммит вызывается только когда есть активный редактор */
        if (current) this.moveToMruFront(current);
        /* v8 ignore stop */
    }

    public closeTab(index: number): void {
        if (index < 0 || index >= this.panes.length) return;

        // Структурное изменение делает замороженный список серии невалидным.
        this.cyclingActive = false;

        const editor = this.panes[index];
        this.panes.splice(index, 1);
        const mruIndex = this.mruOrder.indexOf(editor);
        /* v8 ignore start -- defensive: каждый открытый редактор присутствует в mruOrder */
        if (mruIndex >= 0) this.mruOrder.splice(mruIndex, 1);
        /* v8 ignore stop */
        editor.dispose();

        if (this.panes.length === 0) {
            this.activeIndexValue = -1;
            // Компонент снимает view закрытого редактора (фокус гаснет вместе с ним).
            this.fireEditorsChanged();
            this.fireActiveEditorChanged(null);
        } else if (index <= this.activeIndexValue) {
            this.activeIndexValue = Math.max(0, this.activeIndexValue - 1);
            const activeEditor = this.panes[this.activeIndexValue];
            this.moveToMruFront(activeEditor);
            this.fireEditorsChanged();
            this.focusEditor();
            this.fireActiveEditorChanged(activeEditor);
        } else {
            // Закрыли вкладку после активной: активный редактор не меняется,
            // компоненту достаточно перерисовать табы.
            this.fireEditorsChanged();
        }
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
        for (const pane of this.panes) {
            if (pane instanceof TextEditorPane && pane.model === editor.model) count++;
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
