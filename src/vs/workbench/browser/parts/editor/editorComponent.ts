import type { IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import type { OverlayAnchorPosition } from "../../../../../../tuidom/ui/contextview/overlayLayer.ts";
import { TUIContextMenuEvent } from "../../../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import type { IEditorStyles } from "../../../../editor/browser/editorElement.ts";
import { EditorElement, unthemedEditorStyles } from "../../../../editor/browser/editorElement.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { PlainTextTokenizer } from "../../../../editor/common/languages/builtin/plainTextTokenizer.ts";
import type { ITokenizationSupport } from "../../../../editor/common/languages/iTokenizationSupport.ts";
import type { FoldingRangeSource } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { ITokenStyleResolver } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IUndoElement } from "../../../../editor/common/model/iUndoElement.ts";
import { DocumentTokenStore } from "../../../../editor/common/tokens/documentTokenStore.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import { computeIndentationFolds } from "../../../../editor/contrib/folding/foldingRangeProvider.ts";
import type { IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";
import type { IMarkerDecoration } from "../../../../platform/markers/common/iMarker.ts";
import { getEditorStyles, } from "../../../../platform/theme/browser/defaultStyles.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemedComponent } from "../../component.ts";

/**
 * View-обвязка одного открытого файла: владеет `EditorElement` (+ его view-state и
 * токен-кешем) и скроллбаром ({@link view} — `ScrollBarDecorator`). Парная модель
 * ({@link TextFileModel}) приходит в конструктор; компонент подписывается на её
 * события: пересоздание документа (перечитка с диска) пересобирает view-state и
 * `EditorElement`, смена языка / догрузившаяся грамматика пересаживают токенизатор,
 * правки контента планируют пересчёт folding-регионов. Undo-движок (`UndoManager`)
 * живёт в `EditorElement`; его роутинг в общую историю компонент перепривязывает к
 * модели при каждом пересоздании редактора (`TextFileModel.attachUndoRouting`).
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

export class EditorComponent extends ThemedComponent {
    public readonly view: ScrollBarDecorator;

    public get viewState(): EditorViewState {
        return this.editorViewState;
    }

    private readonly model: TextFileModel;
    private readonly tokenizationRegistry: TokenizationRegistry;
    private readonly tokenStyleResolver: ITokenStyleResolver;
    private editorViewState: EditorViewState;
    private editor: EditorElement;
    private tokenStore: DocumentTokenStore;
    private foldingRecomputeScheduled = false;
    /**
     * Источник провайдерских областей сворачивания (host/харнесс подключает сюда
     * `languages.provideFoldingRanges`). Undefined ⇒ только indentation-фолды.
     */
    private foldingRangeSourceValue?: FoldingRangeSource;
    /**
     * Монотонный номер folding-запроса: асинхронный ответ провайдера применяется
     * только если запрос ещё актуален (не устарел из-за нового пересчёта после
     * правки). Отсекает гонку sync-indentation ↔ async-provider.
     */
    private foldingRequestSeq = 0;
    private componentDisposed = false;
    /**
     * Подписчики на смену курсора/выделения. Держим их здесь, а не на view-state:
     * при перечитке файла с диска view-state пересоздаётся, а подписчик (extension
     * host, который проецирует выделение в субпроцесс) должен это пережить.
     */
    private readonly selectionListeners: (() => void)[] = [];
    /** Текущая подписка на view-state; перевешивается при его пересоздании. */
    private viewStateCursorSubscription?: IDisposable;
    /**
     * Кэш стилей редактора из последнего updateStyles: EditorElement пересоздаётся
     * при перечитке модели с диска, и свежий экземпляр должен получить те же
     * стили без повторного визита темы.
     */
    private currentEditorStyles: IEditorStyles = unthemedEditorStyles;

    public get foldingRangeSource(): FoldingRangeSource | undefined {
        return this.foldingRangeSourceValue;
    }

    /**
     * Подключает провайдерский folding-источник. Переустановка пере-считывает
     * области (extension host мог активироваться уже после открытия файла).
     */
    public set foldingRangeSource(source: FoldingRangeSource | undefined) {
        this.foldingRangeSourceValue = source;
        this.recomputeFoldingRegions();
    }

    /**
     * Подписка на смену курсора/выделения (движение каретки, набор, мышь,
     * undo/redo). Переживает пересоздание view-state при перечитке файла с диска.
     */
    public onDidChangeSelection(cb: () => void): IDisposable {
        this.selectionListeners.push(cb);
        return {
            dispose: (): void => {
                const idx = this.selectionListeners.indexOf(cb);
                if (idx >= 0) this.selectionListeners.splice(idx, 1);
            },
        };
    }

    /** Перевешивает форвардинг cursor-change на текущий view-state. */
    private attachSelectionForwarding(): void {
        this.viewStateCursorSubscription?.dispose();
        this.viewStateCursorSubscription = this.editorViewState.onDidChangeCursorPosition(() => {
            for (const cb of [...this.selectionListeners]) cb();
        });
    }

    public constructor(
        themeService: ThemeService,
        tokenizationRegistry: TokenizationRegistry,
        tokenStyleResolver: ITokenStyleResolver,
        model: TextFileModel,
    ) {
        super(themeService);

        this.model = model;
        this.tokenizationRegistry = tokenizationRegistry;
        this.tokenStyleResolver = tokenStyleResolver;

        this.editorViewState = new EditorViewState(model.document);
        this.tokenStore = new DocumentTokenStore(model.document, this.ensureTokenizerForLanguage(model.languageId));
        this.editorViewState.tokenStore = this.tokenStore;
        this.editor = new EditorElement(this.editorViewState);
        this.editor.tokenStyleResolver = tokenStyleResolver;
        this.editor.focusable = true;
        this.attachUndoRouting();
        this.attachSelectionForwarding();
        this.view = new ScrollBarDecorator(this.editor);

        // Шов модели к редактирующей поверхности: правки, которые модель применяет
        // сама (save-участник, setEol, applyExternalEdits), идут через актуальные
        // view-state/редактор — замыкание читает поля компонента, поэтому переживает
        // пересоздание EditorElement при перечитке.
        model.attachEditTarget({
            cloneSelections: () => this.editorViewState.cloneSelections(),
            applyEdits: (edits, label) => this.editorViewState.applyEdits(edits, label),
            pushUndo: (element) => {
                this.pushUndo(element);
            },
            markDirty: () => {
                this.editor.markDirty();
            },
        });

        this.register(
            model.onDidReloadDocument(() => {
                this.rebuildForReloadedDocument();
            }),
        );
        // Смена языка (setLanguage / saveAs с новым расширением) пересаживает
        // токен-кеш на токенизатор языка назначения.
        this.register(
            model.onDidChangeLanguage(() => {
                this.applyTokenizer();
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
        this.register({
            dispose: () => {
                this.componentDisposed = true;
                this.viewStateCursorSubscription?.dispose();
            },
        });
        this.recomputeFoldingRegions();
        this.initStyles();
    }

    /**
     * Пересобирает view поверх пересозданного документа модели (перечитка с диска):
     * свежие view-state/токен-кеш/EditorElement — undo, курсор и скролл сбрасываются,
     * как при открытии файла заново. Стили и контекст-меню переносятся из кэша,
     * undo-роутинг перепривязывается к новому `UndoManager`.
     */
    private rebuildForReloadedDocument(): void {
        // Read-only — свойство редактора, а не документа: перечитка не должна его
        // снимать. Без переноса «Reopen with Encoding» на read-only вкладке молча
        // возвращал её в редактируемое состояние.
        const wasReadOnly = this.editorViewState.readOnly;
        // Фокус переносим на новый виджет: старый уходит с дерева, и `FocusManager`
        // остаётся указывать в никуда — клавиатура переставала доходить куда-либо
        // вовсе. Заметнее всего это было на смене канала Output, где пересборка
        // происходит на каждое переключение.
        const hadFocus = holdsFocus(this.editor);
        this.editorViewState = new EditorViewState(this.model.document);
        this.editorViewState.readOnly = wasReadOnly;
        this.tokenStore.dispose();
        this.tokenStore = new DocumentTokenStore(
            this.model.document,
            this.ensureTokenizerForLanguage(this.model.languageId),
        );
        this.editorViewState.tokenStore = this.tokenStore;
        this.editor = new EditorElement(this.editorViewState);
        this.editor.tokenStyleResolver = this.tokenStyleResolver;
        this.editor.focusable = true;
        this.editor.setStyles(this.currentEditorStyles);
        this.attachUndoRouting();
        // Курсор сброшен на (0,0) вместе с view-state — перевешиваем форвардинг и
        // сообщаем подписчикам, иначе extension host остался бы со старым выделением.
        this.attachSelectionForwarding();
        for (const cb of [...this.selectionListeners]) cb();
        this.view.setChild(this.editor);
        this.recomputeFoldingRegions();
        if (hadFocus) this.editor.focus();
    }

    /** Подключает undo-движок текущего `EditorElement` к общей истории модели. */
    private attachUndoRouting(): void {
        const editor = this.editor;
        this.model.attachUndoRouting(editor.undoManager, () => {
            editor.markDirty();
        });
    }

    protected updateStyles(): void {
        this.currentEditorStyles = getEditorStyles(this.theme);
        const fg = this.theme.getRequiredColor("editor.foreground");
        const bg = this.theme.getRequiredColor("editor.background");
        this.editor.style = { fg, bg };
        this.editor.setStyles(this.currentEditorStyles);
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
     * Применяет к view-state'у редактора частичный набор настроек indent.
     * После изменений принудительно отключает auto-detect (если расширение
     * выставило размер таба, оно знает, что делает) и помечает редактор
     * dirty, чтобы изменения отрисовались в следующем кадре.
     */
    public setIndentOptions(patch: { tabSize?: number; insertSpaces?: boolean }): void {
        let changed = false;
        if (patch.tabSize !== undefined && patch.tabSize > 0 && this.editorViewState.tabSize !== patch.tabSize) {
            this.editorViewState.tabSize = patch.tabSize;
            changed = true;
        }
        if (patch.insertSpaces !== undefined && this.editorViewState.insertSpaces !== patch.insertSpaces) {
            this.editorViewState.insertSpaces = patch.insertSpaces;
            changed = true;
        }
        if (changed) {
            this.editorViewState.detectIndentation = false;
            this.editor.markDirty();
        }
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
    private ensureTokenizerForLanguage(languageId: string): ITokenizationSupport {
        void this.tokenizationRegistry.load(languageId); // fire-and-forget: load() не реджектится
        return this.tokenizationRegistry.get(languageId) ?? new PlainTextTokenizer();
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
        // Snapshot which start lines are collapsed BEFORE we touch the regions.
        // The indentation apply below may momentarily be empty (a file with no
        // indentation folds), which would wipe the collapsed set before the async
        // provider result restores it — so both applies reuse this one snapshot.
        const collapsedStarts = this.collapsedStartLines();
        const indentation = computeIndentationFolds(this.model.document, this.editorViewState.tabSize);
        this.applyFoldingRegions(indentation, collapsedStarts);

        const source = this.foldingRangeSourceValue;
        if (source === undefined) return;

        // Snapshot request identity: a later recompute (after an edit or a
        // provider re-registration) bumps the sequence and invalidates this
        // in-flight request, so a stale async answer never clobbers fresh state.
        const requestSeq = ++this.foldingRequestSeq;
        void source({
            uri: this.model.uri.toString(),
            languageId: this.model.languageId,
            text: this.model.document.getText(),
        })
            .then((providerRegions) => {
                if (requestSeq !== this.foldingRequestSeq || this.componentDisposed) return;
                if (providerRegions.length === 0) return; // nothing to merge, indentation stays
                this.applyFoldingRegions(mergeFoldingRegions(indentation, providerRegions), collapsedStarts);
            })
            .catch(() => {
                // Provider failed/timed out: indentation folds already applied stand.
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

/** Держит ли фокус сам виджет или что-то в его поддереве. */
function holdsFocus(editor: EditorElement): boolean {
    const active = editor.getRoot()?.focusManager?.activeElement ?? null;
    return active !== null && active.getAncestorPath().includes(editor);
}
