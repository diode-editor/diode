import { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";

import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { mark } from "../../../../base/common/performance.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import { PlainTextTokenizer } from "../../../../editor/common/languages/builtin/plainTextTokenizer.ts";
import type { FoldingRangeProvider } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { ILanguageConfigurationService } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import { NULL_LANGUAGE_CONFIGURATION_SERVICE } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ITokenizationSupport } from "../../../../editor/common/languages/iTokenizationSupport.ts";
import type { ITokenStyleResolver } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IExternalDecorations } from "../../../../editor/common/model/iEditorDecoration.ts";
import type { IGhostText } from "../../../../editor/common/model/iGhostText.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IUndoElement } from "../../../../editor/common/model/iUndoElement.ts";
import { DocumentTokenStore } from "../../../../editor/common/tokens/documentTokenStore.ts";
import type { WordWrapMode } from "../../../../editor/common/viewModel/editorViewState.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import { computeIndentationFolds } from "../../../../editor/contrib/folding/foldingRangeProvider.ts";
import type { IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";
import { provideFoldingRanges } from "../../../../editor/contrib/folding/syntaxRangeProvider.ts";
import type { IMarkerDecoration } from "../../../../platform/markers/common/iMarker.ts";
import type { WorkbenchColorKey } from "../../../../platform/theme/common/colors/colorContributions.ts";
import type { BaseTextEditorModel, ITextEditTarget } from "../../../common/editor/textEditorModel.ts";
import { Component } from "../../component.ts";

/**
 * View-обвязка одной вью открытого файла: владеет `EditorElement` (+ его
 * view-state и токен-кешем) и скроллбаром ({@link view} — `ScrollBarDecorator`).
 * Модель ({@link BaseTextEditorModel}) приходит в конструктор и может делиться
 * несколькими компонентами (один документ в нескольких группах); компонент
 * подписывается на её события: пересоздание документа (перечитка с диска)
 * пересобирает view-state и `EditorElement`, смена языка / догрузившаяся
 * грамматика пересаживают токенизатор, правки контента планируют пересчёт
 * folding-регионов. Undo-движок (`UndoManager`) живёт на модели — один на
 * документ; компонент лишь выдаёт его своему `EditorElement`.
 */
/**
 * Union of indentation folds and extension-provider folds. At most one region
 * per start line survives — the provider's wins on a shared start line (it's the
 * more specific, marker-driven range). Result is sorted by start line, the order
 * the fold model and gutter expect.
 */
function mergeFoldingRegions(indentation: IFoldingRegion[], provider: readonly IFoldingRegion[]): IFoldingRegion[] {
    const byStart = new Map<number, IFoldingRegion>();
    for (const region of indentation) byStart.set(region.startLine, region);
    for (const region of provider) byStart.set(region.startLine, { ...region });
    return [...byStart.values()].sort((a, b) => a.startLine - b.startLine);
}

/** Фон редактора по умолчанию — тот же, что у редакторской группы. */
const DEFAULT_BACKGROUND_TOKEN = "editor.background";

/**
 * Отступные настройки из `editor.*`. Ключ, которого нет в конфиге, отсутствует
 * и здесь — тогда действует встроенный дефолт view-state'а.
 */
export interface IIndentConfiguration {
    readonly tabSize?: number;
    readonly insertSpaces?: boolean;
    readonly detectIndentation?: boolean;
}

export class EditorComponent extends Component {
    public readonly view: ScrollBarDecorator;

    public get viewState(): EditorViewState {
        return this.editorViewState;
    }

    private readonly model: BaseTextEditorModel;
    private readonly tokenizationRegistry: TokenizationRegistry;
    private readonly tokenStyleResolver: ITokenStyleResolver;
    private readonly languageConfiguration: ILanguageConfigurationService;
    private editorViewState: EditorViewState;
    private editor: EditorElement;
    private tokenStore: DocumentTokenStore;
    /**
     * Последний применённый `editor.*`-конфиг отступа. Держим у компонента, а не
     * у view-state'а: view-state пересоздаётся на перечитке документа, а
     * настройки — нет.
     */
    private indentConfiguration: IIndentConfiguration = {};
    private foldingRecomputeScheduled = false;
    /**
     * Реестр folding-провайдеров (`ILanguageFeaturesService.foldingRangeProvider`):
     * их области мержатся поверх indentation-фолдов. Нет подошедших документу
     * провайдеров (или реестр не передан — пустой) ⇒ только indentation-фолды.
     */
    private readonly foldingProviders: LanguageFeatureRegistry<FoldingRangeProvider>;
    /** Токен темы, которым красится фон редактора; см. {@link backgroundToken}. */
    private backgroundTokenValue: WorkbenchColorKey = DEFAULT_BACKGROUND_TOKEN;
    /**
     * Регионы фолдинга задаёт владелец вью (панель диффа), авто-пересчёт
     * (indentation + провайдер) выключен. Ставится до первого пересчёта.
     */
    public foldingOwnedExternally = false;
    /**
     * Последний folding-запрос: асинхронный ответ провайдера применяется только
     * если запрос ещё актуален (не перебит новым пересчётом после правки и
     * компонент не снят). Отсекает гонку sync-indentation ↔ async-provider.
     */
    private readonly foldingRequest = new LatestRequest();
    private componentDisposed = false;
    /**
     * Редактирующая поверхность этой вью, прикреплённая к модели (см.
     * {@link BaseTextEditorModel.attachEditTarget}). Хранится, чтобы pane мог передать
     * её моделью как «действующую вью» (setEol, applyExternalEdits).
     */
    private readonly editTargetValue: ITextEditTarget;
    /**
     * Подписчики на смену курсора/выделения. Держим их здесь, а не на view-state:
     * при перечитке файла с диска view-state пересоздаётся, а подписчик (extension
     * host, который проецирует выделение в субпроцесс) должен это пережить.
     */
    private readonly onDidChangeSelectionEmitter = new Emitter<void>();
    /**
     * Подписчики на смену действующих настроек отступа. Как и
     * {@link selectionListeners}, живут на компоненте: view-state пересоздаётся
     * при перечитке документа, а подписка (статус-бар) обязана это пережить.
     */
    private readonly onDidChangeIndentOptionsEmitter = new Emitter<void>();
    private readonly onDidTypeEmitter = new Emitter<string>();

    /** Редактирующая поверхность этой вью — для acting-view путей модели. */
    public get editTarget(): ITextEditTarget {
        return this.editTargetValue;
    }
    /** Текущая подписка на view-state; перевешивается при его пересоздании. */
    private viewStateCursorSubscription?: IDisposable;

    /**
     * Подписка на смену курсора/выделения (движение каретки, набор, мышь,
     * undo/redo). Переживает пересоздание view-state при перечитке файла с диска.
     */
    public readonly onDidChangeSelection = this.onDidChangeSelectionEmitter.event;

    /**
     * Подписка на смену действующих настроек отступа (`tabSize`/`insertSpaces`):
     * решение расширения, перечитка конфига или пере-детекция при перечитке
     * файла с диска. Файрится только при фактическом сдвиге значений.
     */
    public readonly onDidChangeIndentOptions = this.onDidChangeIndentOptionsEmitter.event;

    /** Сообщает подписчикам отступов, если действующие значения сдвинулись. */
    private notifyIndentIfChanged(before: { tabSize: number; insertSpaces: boolean }): void {
        if (
            this.editorViewState.tabSize === before.tabSize &&
            this.editorViewState.insertSpaces === before.insertSpaces
        ) {
            return;
        }
        this.onDidChangeIndentOptionsEmitter.fire();
    }

    /** Перевешивает форвардинг cursor-change на текущий view-state. */
    /**
     * Набор символа (см. {@link EditorElement.onDidType}). Слушатели живут на
     * компоненте и переживают пересоздание `EditorElement` при перечитке файла.
     */
    public readonly onDidType = this.onDidTypeEmitter.event;

    private attachTypeForwarding(): void {
        this.editor.onDidType((text) => {
            this.onDidTypeEmitter.fire(text);
        });
    }

    private attachSelectionForwarding(): void {
        this.viewStateCursorSubscription?.dispose();
        this.viewStateCursorSubscription = this.editorViewState.onDidChangeCursorPosition(() => {
            this.onDidChangeSelectionEmitter.fire();
        });
    }

    public constructor(
        tokenizationRegistry: TokenizationRegistry,
        tokenStyleResolver: ITokenStyleResolver,
        model: BaseTextEditorModel,
        languageConfiguration: ILanguageConfigurationService = NULL_LANGUAGE_CONFIGURATION_SERVICE,
        foldingProviders = new LanguageFeatureRegistry<FoldingRangeProvider>(),
    ) {
        super();
        this.foldingProviders = foldingProviders;

        this.model = model;
        this.tokenizationRegistry = tokenizationRegistry;
        this.tokenStyleResolver = tokenStyleResolver;
        this.languageConfiguration = languageConfiguration;

        this.editorViewState = new EditorViewState(model.document);
        this.tokenStore = new DocumentTokenStore(model.document, this.ensureTokenizerForLanguage(model.languageId));
        this.editorViewState.tokenStore = this.tokenStore;
        this.editor = new EditorElement(this.editorViewState);
        this.editor.tokenStyleResolver = tokenStyleResolver;
        this.attachLanguageConfiguration();
        this.editor.focusable = true;
        this.applyEditorStyle();
        // История одна на документ: элемент получает общий движок модели вместо
        // собственного (одна и та же замена повторяется при пересоздании — см.
        // rebuildForReloadedDocument).
        this.editor.undoManager = model.undoManager;
        this.attachSelectionForwarding();
        this.attachTypeForwarding();
        this.view = new ScrollBarDecorator(this.editor);

        // Шов модели к редактирующей поверхности этой вью: правки, которые модель
        // применяет сама (save-участник, setEol, applyExternalEdits), идут через
        // актуальные view-state/редактор — замыкание читает поля компонента, поэтому
        // переживает пересоздание EditorElement при перечитке.
        this.editTargetValue = {
            cloneSelections: () => this.editorViewState.cloneSelections(),
            applyEdits: (edits, label) => this.editorViewState.applyEdits(edits, label),
            markDirty: () => {
                this.editor.markDirty();
            },
        };
        this.register(model.attachEditTarget(this.editTargetValue));

        // Содержимое заменено целиком (перечитка с диска, смена содержимого
        // владельцем): каретку и фолды view-state уже ремапнул как при любой
        // правке; заново выводим то, что выводится из текста целиком.
        this.register(
            model.document.onDidChangeContent((change) => {
                if (change.isFlush === true) this.handleDocumentFlush();
            }),
        );
        // Смена языка (setLanguage / saveAs с новым расширением) пересаживает
        // токен-кеш на токенизатор языка назначения.
        this.register(
            model.onDidChangeLanguage(() => {
                this.applyTokenizer();
                // Конфигурация нового языка (пары скобок) — тем же ленивым
                // прогревом, что и грамматика.
                void this.languageConfiguration.ensureLoaded(this.model.languageId);
            }),
        );
        this.register(
            model.onDidChangeContent(() => {
                this.scheduleFoldingRecompute();
            }),
        );
        // Грамматики регистрируются асинхронно (ExtensionTokenizationContributor)
        // и могут появиться уже после открытия файла — тогда пересаживаем
        // документ с fallback-токенизатора на настоящий.
        this.register(
            tokenizationRegistry.onDidChange((languageId) => {
                if (languageId === this.model.languageId) this.applyTokenizer();
            }),
        );
        // Состав folding-провайдеров изменился (расширение активировалось уже
        // после открытия файла, второй провайдер, снятие) — пересчитываем
        // области на каждую регистрацию, а не только на переходе «нет ↔ есть».
        this.register(
            foldingProviders.onDidChange(() => {
                this.recomputeFoldingRegions();
            }),
        );
        this.register({
            dispose: () => {
                this.componentDisposed = true;
                this.foldingRequest.dispose();
                this.viewStateCursorSubscription?.dispose();
                this.editorViewState.dispose();
            },
        });
        this.recomputeFoldingRegions();
    }

    /**
     * Содержимое документа заменено целиком: документ, view-state и редактор те
     * же (read-only, фокус, отступы из конфига, стили — на месте), каретка уже
     * ремапнута к новому тексту. Заново — то, что выводится из текста целиком:
     * детект отступа, фолды (сразу, а не с паузой — разметка от прежнего текста
     * ничего не значит) и кламп скролла по новому числу строк.
     */
    private handleDocumentFlush(): void {
        const indentBefore = { tabSize: this.editorViewState.tabSize, insertSpaces: this.editorViewState.insertSpaces };
        const { scrollTop, scrollLeft } = this.editorViewState;
        this.editorViewState.runDetectIndentation();
        this.notifyIndentIfChanged(indentBefore);
        this.recomputeFoldingRegions();
        // Вьюпорт — ПОСЛЕ пересчёта фолдов: тот заканчивается reveal'ом каретки
        // и увёл бы вьюпорт к ней; внешняя правка уводить его не должна. Кламп —
        // по новому числу строк.
        this.editorViewState.scrollTop = Math.min(scrollTop, Math.max(0, this.editorViewState.getViewLineCount() - 1));
        this.editorViewState.scrollLeft = scrollLeft;
    }

    /**
     * Фон редактора: имя токена темы. По умолчанию `editor.background` —
     * редактор вкладки. Редактор, живущий не в редакторской группе, ставит свой
     * токен и перестаёт выбиваться из окружения: у Output это фон нижней панели
     * (`panel.background`), как у Problems и терминала.
     *
     * Сеттер, а не поле: `applyEditorStyle` зовётся ещё и при пересоздании
     * `EditorElement` (перечитка файла с диска), так что выбранный фон это переживает.
     */
    public set backgroundToken(token: WorkbenchColorKey) {
        this.backgroundTokenValue = token;
        this.applyEditorStyle();
    }

    /** Цвета редактора — токены (Н3); ставятся при создании EditorElement. */
    private applyEditorStyle(): void {
        this.editor.style = { fg: "editor.foreground", bg: this.backgroundTokenValue };
        // Свой фон отменяет тематический фон гуттера: темы вправе прибить
        // editorGutter.background к editor.background (dark2026), и гуттер остался
        // бы слева полосой чужого цвета. Дефолтный фон — дефолтное поведение.
        this.editor.gutterBackgroundToken =
            this.backgroundTokenValue === DEFAULT_BACKGROUND_TOKEN ? "editorGutter.background" : null;
    }

    public onDidChangeCursorPosition(listener: () => void): IDisposable {
        return this.editorViewState.onDidChangeCursorPosition(listener);
    }

    /**
     * Экранный якорь каретки для completion-попапа, или `null`, если каретка вне
     * видимой области. Делегирует в {@link EditorElement.getCaretScreenCell}.
     */
    public getCaretAnchor(): OverlayAnchorPosition | null {
        const cell = this.editor.getCaretScreenCell();
        if (cell === null) return null;
        return { screenX: cell.x, screenY: cell.y, preferBelow: true };
    }

    /**
     * Открывает контекстное меню редактора с клавиатуры (Shift+F10): диспатчит
     * синтетическое событие "contextmenu" на элементе редактора — командный путь
     * сходится в общий пайплайн editor/contrib/contextmenu (якорь — каретка).
     */
    public showContextMenu(): void {
        this.editor.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "keyboard",
                button: "none",
                screenX: this.editor.globalPosition.x,
                screenY: this.editor.globalPosition.y,
                localX: 0,
                localY: 0,
            }),
        );
    }

    public focus(): void {
        this.editor.focus();
    }

    public pushUndo(element: IUndoElement | undefined): void {
        if (element) {
            this.editor.undoManager.pushUndoElement(element);
        }
    }

    /**
     * Применяет к view-state'у редактора частичный набор настроек indent —
     * дверь для расширений (`editor.options`, стоковый EditorConfig). Такое
     * решение главнее и детекции, и конфига: расширение знает про файл то,
     * чего не знаем ни мы, ни настройки. Помечает редактор dirty, чтобы
     * изменения отрисовались в следующем кадре.
     */
    public setIndentOptions(patch: { tabSize?: number; insertSpaces?: boolean }): void {
        let applied = false;
        let changed = false;
        // Неположительный размер таба — не решение, а мусор: считаем его так же,
        // как отсутствие ключа.
        const tabSize = patch.tabSize ?? 0;
        if (tabSize > 0) {
            applied = true;
            if (this.editorViewState.tabSize !== tabSize) {
                this.editorViewState.tabSize = tabSize;
                changed = true;
            }
        }
        if (patch.insertSpaces !== undefined) {
            applied = true;
            if (this.editorViewState.insertSpaces !== patch.insertSpaces) {
                this.editorViewState.insertSpaces = patch.insertSpaces;
                changed = true;
            }
        }
        // Флаг взводим по факту решения расширения, а не по факту сдвига числа:
        // совпавшее с текущим значение — тоже решение, и перечитка конфига не
        // должна его отменять.
        if (applied) this.editorViewState.indentExplicitlySet = true;
        if (changed) {
            this.editor.markDirty();
            this.onDidChangeIndentOptionsEmitter.fire();
        }
    }

    /**
     * Применяет `editor.tabSize` / `editor.insertSpaces` / `editor.detectIndentation`.
     * В отличие от {@link setIndentOptions} это НЕ приказ выставить отступ, а
     * база для детекции: при включённом `detectIndentation` содержимое файла
     * главнее конфига (как в VS Code). Конфиг запоминаем — view-state
     * пересоздаётся при перечитке документа, а настройки обязаны пережить это.
     */
    public applyIndentConfiguration(config: IIndentConfiguration): void {
        const before = { tabSize: this.editorViewState.tabSize, insertSpaces: this.editorViewState.insertSpaces };
        this.indentConfiguration = config;
        this.applyIndentConfigurationToViewState();
        this.editor.markDirty();
        this.notifyIndentIfChanged(before);
    }

    private applyIndentConfigurationToViewState(): void {
        const { insertSpaces, detectIndentation } = this.indentConfiguration;
        // Ключ, которого в конфиге нет, не трогает встроенный дефолт view-state'а
        // (неположительный `tabSize` — тот же случай, см. setIndentOptions).
        const tabSize = this.indentConfiguration.tabSize ?? 0;
        if (tabSize > 0) this.editorViewState.configuredTabSize = tabSize;
        if (insertSpaces !== undefined) this.editorViewState.configuredInsertSpaces = insertSpaces;
        if (detectIndentation !== undefined) this.editorViewState.detectIndentation = detectIndentation;
        this.editorViewState.runDetectIndentation();
    }

    /**
     * Enables/disables highlighting occurrences of the word under the cursor
     * (VS Code `editor.occurrencesHighlight`). Repaints so the change is visible.
     */
    public setOccurrenceHighlightEnabled(enabled: boolean): void {
        if (this.editor.occurrenceHighlightEnabled === enabled) return;
        this.editor.occurrenceHighlightEnabled = enabled;
        this.editor.markDirty();
    }

    /**
     * Sets how many lines to keep between the cursor and the viewport edge when
     * scrolling it into view (VS Code's `editor.cursorSurroundingLines`). Negative
     * or fractional values are normalized to a non-negative integer.
     */
    public setCursorSurroundingLines(lines: number): void {
        const normalized = Math.max(0, Math.floor(lines));
        if (this.editorViewState.cursorSurroundingLines === normalized) return;
        this.editorViewState.cursorSurroundingLines = normalized;
        this.editor.markDirty();
    }

    /**
     * Применяет `editor.wordWrap`/`editor.wordWrapColumn` к view-state.
     * Включение сбрасывает горизонтальный скролл (инвариант «wrap ⇒
     * scrollLeft ≡ 0») и пере-показывает первичную каретку: проекция меняет
     * нумерацию рядов, и без reveal вьюпорт «уезжал» бы с места правки — VS
     * Code при toggle тоже сохраняет позицию каретки, а не scrollTop.
     */
    public setWordWrap(mode: WordWrapMode, column: number): void {
        const viewState = this.editorViewState;
        if (viewState.wordWrap === mode && viewState.wordWrapColumn === column) return;
        viewState.wordWrap = mode;
        viewState.wordWrapColumn = column;
        if (mode !== "off") viewState.scrollLeft = 0;
        viewState.ensurePrimaryCursorVisible();
        this.editor.markDirty();
    }

    /**
     * Sets the search-match decorations rendered by the editor and repaints.
     * `currentIndex` is the active match (highlighted distinctly), or -1.
     */
    public setSearchDecorations(matches: IRange[], currentIndex: number): void {
        this.editorViewState.searchMatches = matches;
        this.editorViewState.currentSearchMatchIndex = currentIndex;
        this.editor.markDirty();
    }

    /**
     * Sets the diagnostic squiggle decorations rendered by the editor and
     * repaints. Pushed by the diagnostics service from the marker service.
     */
    public setMarkerDecorations(decorations: readonly IMarkerDecoration[]): void {
        this.editor.markerDecorations = decorations;
        this.editor.markDirty();
    }

    /**
     * Sets the gutter change-bar decorations (SCM/git dirty-diff) rendered by
     * the editor and repaints. Colours arrive already resolved — this does not
     * touch the theme. Pushed by the source-control/git adapter.
     */
    public setGutterChangeDecorations(decorations: readonly IGutterChangeDecoration[]): void {
        this.editor.gutterChangeDecorations = decorations;
        this.editor.markDirty();
    }

    /**
     * Внешние декорации владельца вью (панель диффа): фоны added/removed-строк,
     * intra-line спаны, маркеры `-`/`+`, наполнение зон. Цвета — токены темы,
     * резолвятся при отрисовке.
     */
    public setDecorations(decorations: IExternalDecorations): void {
        this.editor.decorations = decorations;
        this.editor.markDirty();
    }

    /**
     * Ставит/снимает призрачную подсказку (ghost text инлайн-подсказок).
     * Перечитка документа с диска пересоздаёт `EditorElement` — подсказка
     * при этом гаснет сама (сервис к тому моменту её уже инвалидировал).
     */
    public setGhostText(ghost: IGhostText | null): void {
        this.editor.setGhostText(ghost);
    }

    /** Scrolls a range into view (expanding folds if needed) and repaints. */
    public revealRange(range: IRange): void {
        this.editorViewState.revealRange(range);
        this.editor.markDirty();
    }

    /** Logical line count of the open document. */
    public get lineCount(): number {
        return this.editorViewState.lineCount;
    }

    /** 0-based line of the primary cursor. */
    public get primaryCursorLine(): number {
        return this.editorViewState.primaryCursorLine;
    }

    /** 0-based character offset of the primary cursor. */
    public get primaryCursorColumn(): number {
        return this.editorViewState.primaryCursorColumn;
    }

    /**
     * Moves the primary cursor to (`line`, `column`) — both 0-based — clamping to
     * document bounds and revealing the target. Backs Go-to-Line navigation.
     */
    public goToPosition(line: number, column = 0): void {
        this.editorViewState.goToPosition(line, column);
        this.editor.markDirty();
    }

    /**
     * Отдаёт токенайзер языка, попутно запуская его ленивую загрузку. Это наш
     * аналог `onLanguage`-активации: грамматика читается только когда язык
     * реально понадобился документу. Пока она едет — работаем на fallback'е;
     * подписка на `tokenizationRegistry.onDidChange` пересадит нас, когда
     * support доедет.
     */
    /**
     * Подключает редактору источник language configuration (авто-закрытие
     * скобок) и запускает её ленивый прогрев — наш аналог `onLanguage` для
     * пар, парный `ensureTokenizerForLanguage`. Источник — замыкание на
     * АКТУАЛЬНЫЙ язык модели: смена языка не требует перевешивания.
     */
    private attachLanguageConfiguration(): void {
        this.editor.languageConfigurationSource = () => this.languageConfiguration.get(this.model.languageId);
        void this.languageConfiguration.ensureLoaded(this.model.languageId);
    }

    private ensureTokenizerForLanguage(languageId: string): ITokenizationSupport {
        void this.tokenizationRegistry.load(languageId); // fire-and-forget: load() не реджектится
        const support = this.tokenizationRegistry.get(languageId);
        if (support === undefined) return new PlainTextTokenizer();
        // Веха лестницы старта: грамматика у редактора на руках — первый кадр
        // после этой вехи и есть «кадр с подсветкой» (без трассы — no-op).
        mark("editor:tokenizer-ready", { languageId });
        return support;
    }

    /** Пересаживает токен-кеш текущего документа на актуальный токенизатор. */
    private applyTokenizer(): void {
        this.tokenStore.setTokenizationSupport(this.ensureTokenizerForLanguage(this.model.languageId));
        this.editor.markDirty();
    }

    /**
     * Schedules a folding recompute for after the current edit finishes. The
     * document fires `onDidChangeContent` mid-edit, *before* the view-state has
     * shifted existing regions for the change ({@link EditorViewState.adjustFoldingRegionsForEdits}).
     * Recomputing on a microtask lets that shift land first, so the merge below
     * reads collapsed regions at their post-edit line numbers. Coalesced so a
     * burst of edits triggers a single recompute.
     */
    private scheduleFoldingRecompute(): void {
        if (this.foldingRecomputeScheduled) return;
        this.foldingRecomputeScheduled = true;
        queueMicrotask(() => {
            this.foldingRecomputeScheduled = false;
            if (this.componentDisposed) return;
            this.recomputeFoldingRegions();
        });
    }

    /**
     * Recomputes folding regions for the current document. Indentation folds are
     * the always-present baseline (VS Code recomputes ranges on every content
     * change the same way); if an extension folding provider is wired, its ranges
     * are fetched asynchronously and **merged on top** (union — provider ∪
     * indentation, provider winning on a shared start line) so the user never
     * loses indentation folding for languages the provider only partially covers.
     * Collapsed state is carried across by start line on every apply.
     */
    private recomputeFoldingRegions(): void {
        // Регионы задаёт владелец вью (панель диффа: свёртка unchanged-кусков) —
        // авто-пересчёт indentation-фолдов и провайдера перетёр бы их, а его
        // ensurePrimaryCursorVisible разъезжал бы синхронный скролл сторон.
        if (this.foldingOwnedExternally) return;
        // Snapshot which start lines are collapsed BEFORE we touch the regions.
        // The indentation apply below may momentarily be empty (a file with no
        // indentation folds), which would wipe the collapsed set before the async
        // provider result restores it — so both applies reuse this one snapshot.
        const collapsedStarts = this.collapsedStartLines();
        const indentation = computeIndentationFolds(this.model.document, this.editorViewState.tabSize);
        this.applyFoldingRegions(indentation, collapsedStarts);

        // Every recompute (an edit, a provider registered or removed) supersedes
        // the in-flight request — including the one that finds no providers
        // left: a late answer from a removed provider must not come back. A
        // failed/timed-out provider answers "no regions" inside
        // provideFoldingRanges — indentation folds stand.
        const ticket = this.foldingRequest.start();
        const providers = this.foldingProviders.ordered(this.model);
        // Stryker disable next-line ConditionalExpression: with no providers the aggregator answers [] and the branch below returns the same way — the guard only spares the aggregator call
        if (providers.length === 0) return;

        void provideFoldingRanges(providers, {
            uri: this.model.uri.toString(),
            languageId: this.model.languageId,
            versionId: this.model.document.versionId,
        }).then((providerRegions) => {
            if (ticket.isStale()) return;
            // Stryker disable next-line ConditionalExpression: merging an empty set re-applies the indentation folds already applied above — the guard only skips that no-op
            if (providerRegions.length === 0) return; // nothing to merge, indentation stays
            this.applyFoldingRegions(mergeFoldingRegions(indentation, providerRegions), collapsedStarts);
        });
    }

    /** Start lines of regions currently collapsed in the view state. */
    private collapsedStartLines(): Set<number> {
        const starts = new Set<number>();
        for (const region of this.editorViewState.foldedRegions) {
            if (region.isCollapsed) starts.add(region.startLine);
        }
        return starts;
    }

    /**
     * Applies a fresh set of folding regions, carrying the collapsed state of any
     * region that still starts on the same line (so a recompute or a provider
     * merge doesn't visibly re-expand what the user folded). `priorCollapsed` is
     * unioned with the currently-collapsed lines so a collapse made before the
     * recompute survives an intermediate empty apply.
     */
    private applyFoldingRegions(regions: IFoldingRegion[], priorCollapsed: ReadonlySet<number>): void {
        const collapsedStarts = this.collapsedStartLines();
        for (const start of priorCollapsed) collapsedStarts.add(start);
        for (const region of regions) {
            if (collapsedStarts.has(region.startLine)) region.isCollapsed = true;
        }
        this.editorViewState.setFoldingRegions(regions);
        // If the recompute re-collapsed a region around the just-edited line (e.g.
        // Tab indented the line below a collapsed block into it), keep the caret —
        // and the text under it — visible, matching VS Code.
        this.editorViewState.ensurePrimaryCursorVisible();
        this.editor.markDirty();
    }

    /** Collapses the innermost region at the primary cursor. */
    public foldAtCursor(): void {
        this.editorViewState.foldRegionContaining(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    /** Expands the innermost collapsed region at the primary cursor. */
    public unfoldAtCursor(): void {
        this.editorViewState.unfoldRegionContaining(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    /** Toggles the innermost region at the primary cursor. */
    public toggleFoldAtCursor(): void {
        this.editorViewState.toggleFoldContaining(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    /** Collapses every folding region in the document. */
    public foldAll(): void {
        this.editorViewState.foldAll();
        this.editor.markDirty();
    }

    /** Expands every folding region in the document. */
    public unfoldAll(): void {
        this.editorViewState.unfoldAll();
        this.editor.markDirty();
    }

    /** Collapses the innermost region at the cursor and every region nested inside it. */
    public foldRecursivelyAtCursor(): void {
        this.editorViewState.foldRecursively(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    /** Expands the innermost region at the cursor and every region nested inside it. */
    public unfoldRecursivelyAtCursor(): void {
        this.editorViewState.unfoldRecursively(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    /** Folds the document down to the given nesting level. */
    public foldLevel(level: number): void {
        this.editorViewState.foldLevel(level);
        this.editor.markDirty();
    }

    /** Moves the caret to the header of the next foldable region. */
    public gotoNextFold(): void {
        this.editorViewState.gotoNextFold(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    /** Moves the caret to the header of the previous foldable region. */
    public gotoPreviousFold(): void {
        this.editorViewState.gotoPreviousFold(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }
}
