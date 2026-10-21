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
import type { ITokenizationSupport } from "../../../../editor/common/languages.ts";
import { PlainTextTokenizer } from "../../../../editor/common/languages/builtin/plainTextTokenizer.ts";
import type { FoldingRangeProvider } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { ILanguageConfigurationService } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import { NULL_LANGUAGE_CONFIGURATION_SERVICE } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
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
import type { DocumentSemanticTokensFeature } from "../../../../editor/contrib/semanticTokens/browser/documentSemanticTokens.ts";
import type { IMarkerDecoration } from "../../../../platform/markers/common/iMarker.ts";
import type { WorkbenchColorKey } from "../../../../platform/theme/common/colors/colorContributions.ts";
import type { BaseTextEditorModel, ITextEditTarget } from "../../../common/editor/textEditorModel.ts";
import { Component } from "../../component.ts";

// На общей стартовой строке побеждает регион провайдера (он точнее); сортировка
// по startLine — её ждут модель фолдов и гуттер.
function mergeFoldingRegions(indentation: IFoldingRegion[], provider: readonly IFoldingRegion[]): IFoldingRegion[] {
    const byStart = new Map<number, IFoldingRegion>();
    for (const region of indentation) byStart.set(region.startLine, region);
    for (const region of provider) byStart.set(region.startLine, { ...region });
    return [...byStart.values()].sort((a, b) => a.startLine - b.startLine);
}

const DEFAULT_BACKGROUND_TOKEN = "editor.background";

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
    /** На компоненте, а не на view-state: тот пересоздаётся при перечитке документа. */
    private indentConfiguration: IIndentConfiguration = {};
    private foldingRecomputeScheduled = false;
    private readonly foldingProviders: LanguageFeatureRegistry<FoldingRangeProvider>;
    private backgroundTokenValue: WorkbenchColorKey = DEFAULT_BACKGROUND_TOKEN;
    /** Регионы задаёт владелец вью (панель диффа); ставить до первого пересчёта. */
    public foldingOwnedExternally = false;
    /** Отсекает гонку sync-indentation ↔ async-provider: поздний ответ перебитого запроса не применяется. */
    private readonly foldingRequest = new LatestRequest();
    private componentDisposed = false;
    private readonly editTargetValue: ITextEditTarget;
    /** Не на view-state: тот пересоздаётся при перечитке с диска, а подписчик (extension host) обязан это пережить. */
    private readonly onDidChangeSelectionEmitter = new Emitter<void>();
    /** На компоненте — по той же причине. */
    private readonly onDidChangeIndentOptionsEmitter = new Emitter<void>();
    private readonly onDidTypeEmitter = new Emitter<string>();

    public get editTarget(): ITextEditTarget {
        return this.editTargetValue;
    }
    private viewStateCursorSubscription?: IDisposable;

    public readonly onDidChangeSelection = this.onDidChangeSelectionEmitter.event;

    /** Только при фактическом сдвиге `tabSize`/`insertSpaces`. */
    public readonly onDidChangeIndentOptions = this.onDidChangeIndentOptionsEmitter.event;

    private notifyIndentIfChanged(before: { tabSize: number; insertSpaces: boolean }): void {
        if (
            this.editorViewState.tabSize === before.tabSize &&
            this.editorViewState.insertSpaces === before.insertSpaces
        ) {
            return;
        }
        this.onDidChangeIndentOptionsEmitter.fire();
    }

    /** Переживает пересоздание `EditorElement` при перечитке файла. */
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
        semanticTokens?: DocumentSemanticTokensFeature,
    ) {
        super();
        this.foldingProviders = foldingProviders;

        this.model = model;
        this.tokenizationRegistry = tokenizationRegistry;
        this.tokenStyleResolver = tokenStyleResolver;
        this.languageConfiguration = languageConfiguration;

        this.editorViewState = new EditorViewState(model.document);
        // Кеш TM-токенов подписан на документ, который переживает вью: без
        // dispose подписка висела бы на модели после закрытия вкладки.
        this.tokenStore = this.register(
            new DocumentTokenStore(model.document, this.ensureTokenizerForLanguage(model.languageId)),
        );
        this.editorViewState.tokenStore = this.tokenStore;
        this.editor = new EditorElement(this.editorViewState);
        this.register(
            this.tokenStore.onDidChangeTokens(({ fromLine, toLine }) => {
                this.editor.handleTokensChanged(fromLine, toLine);
            }),
        );
        this.editor.tokenStyleResolver = tokenStyleResolver;
        this.attachLanguageConfiguration();
        this.editor.focusable = true;
        this.applyEditorStyle();
        // История одна на документ; та же замена повторяется в rebuildForReloadedDocument.
        this.editor.undoManager = model.undoManager;
        this.attachSelectionForwarding();
        this.attachTypeForwarding();
        this.view = new ScrollBarDecorator(this.editor);
        if (semanticTokens !== undefined) this.attachSemanticTokens(semanticTokens);

        // Замыкание читает поля компонента, поэтому переживает пересоздание
        // EditorElement при перечитке.
        this.editTargetValue = {
            cloneSelections: () => this.editorViewState.cloneSelections(),
            applyEdits: (edits, label, computeCursorState) =>
                this.editorViewState.applyEdits(edits, label, computeCursorState),
            markDirty: () => {
                this.editor.markDirty();
            },
        };
        this.register(model.attachEditTarget(this.editTargetValue));

        this.register(
            model.document.onDidChangeContent((change) => {
                if (change.isFlush === true) this.handleDocumentFlush();
            }),
        );
        this.register(
            model.onDidChangeLanguage(() => {
                this.applyTokenizer();
                void this.languageConfiguration.ensureLoaded(this.model.languageId);
            }),
        );
        this.register(
            model.onDidChangeContent(() => {
                this.scheduleFoldingRecompute();
            }),
        );
        // Грамматика может зарегистрироваться уже после открытия файла.
        this.register(
            tokenizationRegistry.onDidChange((languageId) => {
                if (languageId === this.model.languageId) this.applyTokenizer();
            }),
        );
        // Пересчёт на каждую регистрацию, а не только на переходе «нет ↔ есть».
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

    private attachSemanticTokens(feature: DocumentSemanticTokensFeature): void {
        const reference = this.register(feature.attach(this.model));
        this.editorViewState.semanticTokens = reference.store;
        this.editor.semanticTokenStyleResolver = feature.styleResolver;
        this.register(
            reference.store.onDidChange(() => {
                this.editor.markDirty();
            }),
        );
        this.register(
            feature.styleResolver.onDidChange(() => {
                this.editor.markDirty();
            }),
        );
        this.register(
            reference.attachViewport({
                getVisibleLineRange: () => {
                    const viewState = this.editorViewState;
                    // Строки за концом вью docLineForViewLine сама прижимает к последней.
                    const top = viewState.scrollTop;
                    return {
                        startLine: viewState.docLineForViewLine(top),
                        endLine: viewState.docLineForViewLine(top + Math.max(viewState.viewportHeight, 1) - 1),
                    };
                },
                onDidChangeVisibleRange: this.editorViewState.onDidChangeView,
            }),
        );
    }

    /** Фолды — сразу, без паузы: разметка от прежнего текста ничего не значит. */
    private handleDocumentFlush(): void {
        const indentBefore = { tabSize: this.editorViewState.tabSize, insertSpaces: this.editorViewState.insertSpaces };
        const { scrollTop, scrollLeft } = this.editorViewState;
        this.editorViewState.runDetectIndentation();
        this.notifyIndentIfChanged(indentBefore);
        this.recomputeFoldingRegions();
        // Вьюпорт — ПОСЛЕ фолдов: их пересчёт кончается reveal'ом каретки, а внешняя
        // правка уводить вьюпорт не должна.
        this.editorViewState.scrollTop = Math.min(scrollTop, Math.max(0, this.editorViewState.getViewLineCount() - 1));
        this.editorViewState.scrollLeft = scrollLeft;
    }

    /**
     * Сеттер, а не поле: `applyEditorStyle` зовётся и при пересоздании
     * `EditorElement` (перечитка с диска), выбранный фон это переживает.
     */
    public set backgroundToken(token: WorkbenchColorKey) {
        this.backgroundTokenValue = token;
        this.applyEditorStyle();
    }

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

    public getCaretAnchor(): OverlayAnchorPosition | null {
        const cell = this.editor.getCaretScreenCell();
        if (cell === null) return null;
        return { screenX: cell.x, screenY: cell.y, preferBelow: true };
    }

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

    /** Решение расширения (`editor.options`, EditorConfig) главнее и детекции, и конфига. */
    public setIndentOptions(patch: { tabSize?: number; insertSpaces?: boolean }): void {
        let applied = false;
        let changed = false;
        // Неположительный размер таба — мусор, как отсутствие ключа.
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
     * Не приказ, а база для детекции: при `detectIndentation` содержимое файла
     * главнее конфига (как в VS Code).
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
        // Неположительный `tabSize` — как отсутствие ключа.
        const tabSize = this.indentConfiguration.tabSize ?? 0;
        if (tabSize > 0) this.editorViewState.configuredTabSize = tabSize;
        if (insertSpaces !== undefined) this.editorViewState.configuredInsertSpaces = insertSpaces;
        if (detectIndentation !== undefined) this.editorViewState.detectIndentation = detectIndentation;
        this.editorViewState.runDetectIndentation();
    }

    public setOccurrenceHighlightEnabled(enabled: boolean): void {
        if (this.editor.occurrenceHighlightEnabled === enabled) return;
        this.editor.occurrenceHighlightEnabled = enabled;
        this.editor.markDirty();
    }

    public setCursorSurroundingLines(lines: number): void {
        const normalized = Math.max(0, Math.floor(lines));
        if (this.editorViewState.cursorSurroundingLines === normalized) return;
        this.editorViewState.cursorSurroundingLines = normalized;
        this.editor.markDirty();
    }

    /**
     * Включение сбрасывает scrollLeft (инвариант «wrap ⇒ scrollLeft ≡ 0») и
     * пере-показывает каретку: проекция меняет нумерацию рядов (VS Code тоже).
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

    /** `currentIndex` — активное совпадение или -1. */
    public setSearchDecorations(matches: IRange[], currentIndex: number): void {
        this.editorViewState.searchMatches = matches;
        this.editorViewState.currentSearchMatchIndex = currentIndex;
        this.editor.markDirty();
    }

    public setMarkerDecorations(decorations: readonly IMarkerDecoration[]): void {
        this.editor.markerDecorations = decorations;
        this.editor.markDirty();
    }

    /** Цвета приходят уже разрешёнными — тему не трогает. */
    public setGutterChangeDecorations(decorations: readonly IGutterChangeDecoration[]): void {
        this.editor.gutterChangeDecorations = decorations;
        this.editor.markDirty();
    }

    public setDecorations(decorations: IExternalDecorations): void {
        this.editor.decorations = decorations;
        this.editor.markDirty();
    }

    /** Перечитка с диска пересоздаёт `EditorElement` — подсказка гаснет сама. */
    public setGhostText(ghost: IGhostText | null): void {
        this.editor.setGhostText(ghost);
    }

    public revealRange(range: IRange): void {
        this.editorViewState.revealRange(range);
        this.editor.markDirty();
    }

    /** Логических строк документа. */
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

    /** `line`, `column` — 0-based; клампится к границам документа. */
    public goToPosition(line: number, column = 0): void {
        this.editorViewState.goToPosition(line, column);
        this.editor.markDirty();
    }

    /** Источник — замыкание на АКТУАЛЬНЫЙ язык модели: смена языка не требует перевешивания. */
    private attachLanguageConfiguration(): void {
        this.editor.languageConfigurationSource = () => this.languageConfiguration.get(this.model.languageId);
        void this.languageConfiguration.ensureLoaded(this.model.languageId);
    }

    private ensureTokenizerForLanguage(languageId: string): ITokenizationSupport {
        void this.tokenizationRegistry.load(languageId); // fire-and-forget: load() не реджектится
        const support = this.tokenizationRegistry.get(languageId);
        if (support === undefined) return new PlainTextTokenizer();
        // Первый кадр после этой вехи — «кадр с подсветкой».
        mark("editor:tokenizer-ready", { languageId });
        return support;
    }

    private applyTokenizer(): void {
        this.tokenStore.setTokenizationSupport(this.ensureTokenizerForLanguage(this.model.languageId));
        this.editor.markDirty();
    }

    /**
     * На микротаске: документ шлёт `onDidChangeContent` посреди правки, ДО сдвига
     * регионов view-state'ом, а пересчёт должен видеть их сдвинутыми.
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
     * Регионы провайдера мержатся поверх indentation-фолдов, а не заменяют их.
     * С провайдером текущие регионы стоят до его ответа, как в VS Code:
     * промежуточный indentation-apply свернул бы Java-метод с многострочной
     * сигнатурой только по параметрам — тело мигало бы на каждом нажатии.
     */
    private recomputeFoldingRegions(): void {
        // Регионы задаёт владелец вью: авто-пересчёт перетёр бы их, а его reveal
        // разъезжал бы синхронный скролл сторон диффа.
        if (this.foldingOwnedExternally) return;
        // Snapshot which start lines are collapsed BEFORE the request: the user
        // may fold while it is in flight, the apply unions both.
        const collapsedStarts = this.collapsedStartLines();
        const indentation = computeIndentationFolds(this.model.document, this.editorViewState.tabSize);

        // Каждый пересчёт перебивает запрос в полёте — и тот, что провайдеров не
        // нашёл: поздний ответ снятого провайдера не должен вернуться.
        const ticket = this.foldingRequest.start();
        const providers = this.foldingProviders.ordered(this.model);
        if (providers.length === 0) {
            this.applyFoldingRegions(indentation, collapsedStarts);
            return;
        }

        void provideFoldingRanges(
            providers,
            {
                uri: this.model.uri.toString(),
                languageId: this.model.languageId,
                versionId: this.model.document.versionId,
            },
            ticket.token,
        ).then((providerRegions) => {
            if (ticket.isStale()) return;
            this.applyFoldingRegions(mergeFoldingRegions(indentation, providerRegions), collapsedStarts);
        });
    }

    private collapsedStartLines(): Set<number> {
        const starts = new Set<number>();
        for (const region of this.editorViewState.foldedRegions) {
            if (region.isCollapsed) starts.add(region.startLine);
        }
        return starts;
    }

    /**
     * `priorCollapsed` объединяется с текущими свёрнутыми — свёртка, сделанная до
     * пересчёта, переживает промежуточный пустой apply.
     */
    private applyFoldingRegions(regions: IFoldingRegion[], priorCollapsed: ReadonlySet<number>): void {
        const collapsedStarts = this.collapsedStartLines();
        for (const start of priorCollapsed) collapsedStarts.add(start);
        for (const region of regions) {
            if (collapsedStarts.has(region.startLine)) region.isCollapsed = true;
        }
        this.editorViewState.setFoldingRegions(regions);
        // Пересчёт мог свернуть регион вокруг правленой строки (Tab увёл её в
        // свёрнутый блок) — каретка остаётся видимой, как в VS Code.
        this.editorViewState.ensurePrimaryCursorVisible();
        this.editor.markDirty();
    }

    public foldAtCursor(): void {
        this.editorViewState.foldRegionContaining(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    public unfoldAtCursor(): void {
        this.editorViewState.unfoldRegionContaining(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    public toggleFoldAtCursor(): void {
        this.editorViewState.toggleFoldContaining(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    public foldAll(): void {
        this.editorViewState.foldAll();
        this.editor.markDirty();
    }

    public unfoldAll(): void {
        this.editorViewState.unfoldAll();
        this.editor.markDirty();
    }

    public foldRecursivelyAtCursor(): void {
        this.editorViewState.foldRecursively(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    public unfoldRecursivelyAtCursor(): void {
        this.editorViewState.unfoldRecursively(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    public foldLevel(level: number): void {
        this.editorViewState.foldLevel(level);
        this.editor.markDirty();
    }

    public gotoNextFold(): void {
        this.editorViewState.gotoNextFold(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }

    public gotoPreviousFold(): void {
        this.editorViewState.gotoPreviousFold(this.editorViewState.selections[0].active.line);
        this.editor.markDirty();
    }
}
