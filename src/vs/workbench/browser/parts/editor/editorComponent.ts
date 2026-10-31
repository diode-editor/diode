import { type CursorStyle, sameCursorStyle } from "@tuidom/core/common/cursorStyle";
import { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { mark } from "../../../../base/common/performance.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { ITokenizationSupport } from "../../../../editor/common/languages.ts";
import { PlainTextTokenizer } from "../../../../editor/common/languages/builtin/plainTextTokenizer.ts";
import type { DocumentColorProvider } from "../../../../editor/common/languages/iColorSource.ts";
import type { FoldingRangeProvider } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { ILanguageConfigurationService } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import { NULL_LANGUAGE_CONFIGURATION_SERVICE } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ITokenStyleResolver } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IExternalDecorations } from "../../../../editor/common/model/iEditorDecoration.ts";
import type { IGhostText } from "../../../../editor/common/model/iGhostText.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IInlineInsertion } from "../../../../editor/common/model/iInlineInsertion.ts";
import type { IUndoElement } from "../../../../editor/common/model/iUndoElement.ts";
import { FeatureDebounce } from "../../../../editor/common/services/languageFeatureDebounce.ts";
import { DocumentTokenStore } from "../../../../editor/common/tokens/documentTokenStore.ts";
import type { IIndentDefaults, WordWrapMode } from "../../../../editor/common/viewModel/editorViewState.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import {
    ColorDetector,
    DEFAULT_COLOR_DECORATORS_OPTIONS,
    type IColorDecoratorsOptions,
} from "../../../../editor/contrib/colorPicker/browser/colorDetector.ts";
import { computeIndentationFolds } from "../../../../editor/contrib/folding/foldingRangeProvider.ts";
import {
    FOLDING_MAXIMUM_REGIONS_DEFAULT,
    limitFoldingRegions,
} from "../../../../editor/contrib/folding/foldingRegionsLimit.ts";
import type { IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";
import { provideFoldingRanges } from "../../../../editor/contrib/folding/syntaxRangeProvider.ts";
import type { DocumentSemanticTokensFeature } from "../../../../editor/contrib/semanticTokens/browser/documentSemanticTokens.ts";
import type { IMarkerDecoration } from "../../../../platform/markers/common/iMarker.ts";
import type { WorkbenchColorKey } from "../../../../platform/theme/common/colors/colorContributions.ts";
import type { BaseTextEditorModel, ITextEditTarget } from "../../../common/editor/textEditorModel.ts";
import { Component } from "../../component.ts";

// On a shared start line the provider region wins (it is more precise); sorted by
// startLine because the folding model and the gutter expect that.
function mergeFoldingRegions(indentation: IFoldingRegion[], provider: readonly IFoldingRegion[]): IFoldingRegion[] {
    const byStart = new Map<number, IFoldingRegion>();
    for (const region of indentation) byStart.set(region.startLine, region);
    for (const region of provider) byStart.set(region.startLine, { ...region });
    return [...byStart.values()].sort((a, b) => a.startLine - b.startLine);
}

const DEFAULT_BACKGROUND_TOKEN = "editor.background";

/** Upstream `languageFeatureDebounceService.for(foldingRangeProvider, 'Folding', { min: 200 })`. */
const FOLDING_DEBOUNCE_MIN_MS = 200;
/** Upstream's default `max` is `min ** 2`. */
const FOLDING_DEBOUNCE_MAX_MS = FOLDING_DEBOUNCE_MIN_MS ** 2;

export type IIndentConfiguration = IIndentDefaults;

export function sameIndentConfiguration(a: IIndentConfiguration, b: IIndentConfiguration): boolean {
    return a.tabSize === b.tabSize && a.insertSpaces === b.insertSpaces && a.detectIndentation === b.detectIndentation;
}

/** Values of `editor.scrollbarMarkers`. */
export type ScrollbarMarkersSetting = "off" | "auto" | "inside" | "outside";

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
    /**
     * `null` in the large-file mode: upstream's plain-text backend still walks every line in the background and
     * keeps an (empty) token array per line — a million of them on a 1M-line file, and for a document on disk
     * every line would be read from disk for nothing. The store is created when the mode ends.
     */
    private tokenStore: DocumentTokenStore | null = null;
    private tokenStoreSubscription: IDisposable | null = null;
    /** Lives on the component, not the view state: the latter is recreated when the document is reloaded. */
    private indentConfiguration: IIndentConfiguration;
    private readonly foldingProviders: LanguageFeatureRegistry<FoldingRangeProvider>;
    /**
     * Upstream `FoldingController.updateScheduler`: a trailing delay from the last trigger, adapted
     * to how long the last recomputes took (`FeatureDebounce`), so a slow provider or a huge file
     * is asked less often. Never on the keystroke itself: the indentation pass walks every line.
     */
    private readonly foldingScheduler = new RunOnceScheduler(() => {
        this.recomputeFoldingRegions();
    }, FOLDING_DEBOUNCE_MIN_MS);
    private readonly foldingDebounce = new FeatureDebounce(FOLDING_DEBOUNCE_MIN_MS, FOLDING_DEBOUNCE_MAX_MS);
    /** `editor.foldingMaximumRegions`. */
    private foldingMaximumRegions = FOLDING_MAXIMUM_REGIONS_DEFAULT;
    private backgroundTokenValue: WorkbenchColorKey = DEFAULT_BACKGROUND_TOKEN;
    /** Regions are set by the view's owner (the diff pane); set this before the first recompute. */
    public foldingOwnedExternally = false;
    /** Guards the sync-indentation ↔ async-provider race: a late reply to a superseded request is dropped. */
    private readonly foldingRequest = new LatestRequest();
    /**
     * Two independent producers: quick diff (git) and extension decoration types. Each one replaces only
     * its own set — otherwise an extension clearing its bars on every keystroke wipes the git bars until the
     * next quick diff recompute (flicker while typing).
     */
    private quickDiffGutterChanges: readonly IGutterChangeDecoration[] = [];
    private extensionGutterChanges: readonly IGutterChangeDecoration[] = [];
    private readonly editTargetValue: ITextEditTarget;
    /**
     * What the configuration asked for; the large-file mode overrides both with "off" until
     * `forcefullyEnableFeatures`, so the request is kept apart from what is applied.
     */
    private occurrenceHighlightRequested = true;
    private wordWrapRequested: { readonly mode: WordWrapMode; readonly column: number } | null = null;
    private readonly semanticTokensFeature: DocumentSemanticTokensFeature | undefined;
    private readonly colorProviders: LanguageFeatureRegistry<DocumentColorProvider> | undefined;
    /** `null` without providers and in the large-file mode (upstream's detector is cut off by the worker's size limit). */
    private colorDetector: ColorDetector | null = null;
    private colorDecoratorsOptions: IColorDecoratorsOptions = DEFAULT_COLOR_DECORATORS_OPTIONS;
    /** Not on the view state: it is recreated on reload from disk, and the extension host subscriber must survive that. */
    private readonly onDidChangeSelectionEmitter = new Emitter<void>();
    /** On the component for the same reason. */
    private readonly onDidChangeIndentOptionsEmitter = new Emitter<void>();
    private readonly onDidTypeEmitter = new Emitter<string>();

    public get editTarget(): ITextEditTarget {
        return this.editTargetValue;
    }
    private viewStateCursorSubscription?: IDisposable;

    public readonly onDidChangeSelection = this.onDidChangeSelectionEmitter.event;

    /** Fires only when `tabSize`/`insertSpaces` actually change. */
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

    /** Survives `EditorElement` recreation when the file is reloaded. */
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
        indentConfiguration: IIndentConfiguration = {},
        colorProviders?: LanguageFeatureRegistry<DocumentColorProvider>,
    ) {
        super();
        this.foldingProviders = foldingProviders;

        this.model = model;
        this.tokenizationRegistry = tokenizationRegistry;
        this.tokenStyleResolver = tokenStyleResolver;
        this.languageConfiguration = languageConfiguration;
        this.indentConfiguration = indentConfiguration;

        this.editorViewState = new EditorViewState(model.document, undefined, indentConfiguration);
        this.editorViewState.isTooLargeForTokenization = this.tooLarge;
        this.semanticTokensFeature = semanticTokens;
        this.colorProviders = colorProviders;
        this.editor = new EditorElement(this.editorViewState);
        this.applyTokenizer();
        this.editor.tokenStyleResolver = tokenStyleResolver;
        this.attachLanguageConfiguration();
        this.editor.focusable = true;
        this.applyEditorStyle();
        // One undo history per document; rebuildForReloadedDocument repeats the same assignment.
        this.editor.undoManager = model.undoManager;
        this.attachSelectionForwarding();
        this.attachTypeForwarding();
        this.view = new ScrollBarDecorator(this.editor);
        // The `editor.scrollbarMarkers` default, for surfaces the configuration never reaches.
        this.view.markerPlacement = "auto";
        this.attachSemanticTokensUnlessTooLarge();
        this.attachColorDetectorUnlessTooLarge();
        this.applyOccurrenceHighlight();

        // The closures read component fields, so they survive EditorElement
        // recreation on reload.
        this.editTargetValue = {
            cloneSelections: () => this.editorViewState.cloneSelections(),
            applyEdits: (edits, label, computeCursorState) =>
                this.editorViewState.applyEdits(edits, label, computeCursorState),
            markDirty: () => {
                this.editor.markDirty();
            },
        };
        this.register(model.attachEditTarget(this.editTargetValue));

        // One subscription for both: the model's own content event fires after the document's flush, and
        // a schedule from it would cancel the provider request the flush handler has just sent.
        this.register(
            model.document.onDidChangeContent((change) => {
                if (change.isFlush === true) this.handleDocumentFlush();
                else this.scheduleFoldingRecompute();
            }),
        );
        this.register(
            model.onDidChangeLanguage(() => {
                this.applyTokenizer();
                void this.languageConfiguration.ensureLoaded(this.model.languageId);
            }),
        );
        // A grammar may be registered after the file is already open.
        this.register(
            tokenizationRegistry.onDidChange((languageId) => {
                if (languageId === this.model.languageId) this.applyTokenizer();
            }),
        );
        // Recompute on every registration, not only on the "none ↔ some" transition.
        this.register(
            foldingProviders.onDidChange(() => {
                this.scheduleFoldingRecompute();
            }),
        );
        // Upstream's "Forcefully Enable Features" for this model: every gate below re-reads the flag.
        this.register(
            model.onDidChangeTooLargeForTokenization(() => {
                this.editorViewState.isTooLargeForTokenization = false;
                this.applyTokenizer();
                this.attachSemanticTokensUnlessTooLarge();
                this.attachColorDetectorUnlessTooLarge();
                this.applyOccurrenceHighlight();
                this.applyWordWrap();
                this.scheduleFoldingRecompute();
            }),
        );
        this.register({
            dispose: () => {
                this.foldingScheduler.dispose();
                this.foldingRequest.dispose();
                this.viewStateCursorSubscription?.dispose();
                this.disposeTokenStore();
                this.editorViewState.dispose();
            },
        });
        // Not on the path to the first frame: on a 200K-line file the indentation pass is ~100 ms, and
        // the delay lands past the frame (upstream triggers the same scheduler on model change).
        this.scheduleFoldingRecompute();
    }

    /**
     * Upstream `isTooLargeForTokenization` gate (`tokenizerSyntaxTokenBackend`, `folding`, `wordHighlighter`,
     * `viewModelImpl` for wrapping): the large-file mode of docs/arch/Editor.md.
     */
    private get tooLarge(): boolean {
        return this.model.isTooLargeForTokenization;
    }

    /**
     * Semantic tokens need the document in the extension host, which a large file never reaches. Called
     * twice at most: here at construction, and once more on the model's single true → false transition.
     */
    private attachSemanticTokensUnlessTooLarge(): void {
        if (this.semanticTokensFeature === undefined || this.tooLarge) return;
        this.attachSemanticTokens(this.semanticTokensFeature);
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
                    // docLineForViewLine itself clamps lines past the end of the view to the last one.
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

    /** Like semantic tokens: at construction, and once more when the large-file mode ends. */
    private attachColorDetectorUnlessTooLarge(): void {
        if (this.colorProviders === undefined || this.tooLarge) return;
        this.colorDetector = this.register(
            new ColorDetector(this.model, this.colorProviders, this.colorDecoratorsOptions, (insertions) => {
                this.editor.setInlineInsertions(insertions);
            }),
        );
    }

    /** `editor.colorDecorators`, `editor.defaultColorDecorators`, `editor.colorDecoratorsLimit`. */
    public setColorDecorators(options: IColorDecoratorsOptions): void {
        this.colorDecoratorsOptions = options;
        this.colorDetector?.setOptions(options);
    }

    /** Folds are recomputed immediately, without the debounce: regions from the old text mean nothing. */
    private handleDocumentFlush(): void {
        const indentBefore = { tabSize: this.editorViewState.tabSize, insertSpaces: this.editorViewState.insertSpaces };
        const { scrollTop, scrollLeft } = this.editorViewState;
        this.editorViewState.runDetectIndentation();
        this.notifyIndentIfChanged(indentBefore);
        this.recomputeFoldingRegions();
        // Restore the viewport AFTER folds: their recompute ends by revealing the cursor, and an
        // external edit must not move the viewport.
        this.editorViewState.scrollTop = Math.min(scrollTop, Math.max(0, this.editorViewState.getViewLineCount() - 1));
        this.editorViewState.scrollLeft = scrollLeft;
    }

    /**
     * A setter, not a field: `applyEditorStyle` also runs when `EditorElement` is
     * recreated (reload from disk), so the chosen background survives that.
     */
    public set backgroundToken(token: WorkbenchColorKey) {
        this.backgroundTokenValue = token;
        this.applyEditorStyle();
    }

    private applyEditorStyle(): void {
        this.editor.style = { fg: "editor.foreground", bg: this.backgroundTokenValue };
        // A custom background overrides the theme's gutter background: themes may pin
        // editorGutter.background to editor.background (dark2026), leaving the gutter
        // as a stripe of a different color on the left. The default background keeps default behavior.
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

    public typeText(text: string): void {
        this.editor.typeText(text);
    }

    public pushUndo(element: IUndoElement | undefined): void {
        if (element) {
            this.editor.undoManager.pushUndoElement(element);
        }
    }

    /** An extension's decision (`editor.options`, EditorConfig) beats both detection and the setting. */
    public setIndentOptions(patch: { tabSize?: number; insertSpaces?: boolean }): void {
        let applied = false;
        let changed = false;
        // A non-positive tab size is garbage, treated as a missing key.
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
        // Set the flag whenever the extension decides, not only when the value changes:
        // a value equal to the current one is still a decision, and re-reading the
        // settings must not undo it.
        if (applied) this.editorViewState.indentExplicitlySet = true;
        if (changed) {
            this.editor.markDirty();
            this.onDidChangeIndentOptionsEmitter.fire();
        }
    }

    /**
     * Not an order but a baseline for detection: with `detectIndentation` the file content
     * beats the setting (as upstream).
     */
    public applyIndentConfiguration(config: IIndentConfiguration): void {
        // Detection reruns on a change of its inputs only, as upstream `setModelOptionsForModel`:
        // the configuration is reapplied on every `editor.*` change, including Alt+Z.
        if (sameIndentConfiguration(this.indentConfiguration, config)) return;
        const before = { tabSize: this.editorViewState.tabSize, insertSpaces: this.editorViewState.insertSpaces };
        this.indentConfiguration = config;
        this.editorViewState.applyIndentDefaults(config);
        this.editor.markDirty();
        this.notifyIndentIfChanged(before);
    }

    public setNerdFont(nerdFont: boolean): void {
        if (this.editor.nerdFont === nerdFont) return;
        this.editor.nerdFont = nerdFont;
        this.editor.markDirty();
    }

    /** `editor.cursorStyle` + `editor.cursorBlinking`; `null` — the terminal's own cursor shape. */
    public setCursorStyle(style: CursorStyle | null): void {
        if (sameCursorStyle(this.editor.cursorStyle, style)) return;
        this.editor.cursorStyle = style;
        this.editor.markDirty();
    }

    public setOccurrenceHighlightEnabled(enabled: boolean): void {
        this.occurrenceHighlightRequested = enabled;
        this.applyOccurrenceHighlight();
    }

    private applyOccurrenceHighlight(): void {
        const enabled = this.occurrenceHighlightRequested && !this.tooLarge;
        if (this.editor.occurrenceHighlightEnabled === enabled) return;
        this.editor.occurrenceHighlightEnabled = enabled;
        this.editor.markDirty();
    }

    /** `editor.scrollbarMarkers`; the decorator knows the same placements, only "off" is its "none". */
    public setScrollbarMarkers(setting: ScrollbarMarkersSetting): void {
        const placement = setting === "off" ? "none" : setting;
        if (this.view.markerPlacement === placement) return;
        this.view.markerPlacement = placement;
        this.view.markDirty();
    }

    public setCursorSurroundingLines(lines: number): void {
        const normalized = Math.max(0, Math.floor(lines));
        if (this.editorViewState.cursorSurroundingLines === normalized) return;
        this.editorViewState.cursorSurroundingLines = normalized;
        this.editor.markDirty();
    }

    /**
     * Enabling resets scrollLeft (invariant "wrap ⇒ scrollLeft ≡ 0") and re-reveals
     * the cursor: the projection renumbers rows (upstream does the same).
     */
    public setWordWrap(mode: WordWrapMode, column: number): void {
        this.wordWrapRequested = { mode, column };
        this.applyWordWrap();
    }

    /** Upstream `viewModelImpl`: a model too large for tokenization gets the lines as they are, unwrapped. */
    private applyWordWrap(): void {
        if (this.wordWrapRequested === null) return;
        const { column } = this.wordWrapRequested;
        const mode = this.tooLarge ? "off" : this.wordWrapRequested.mode;
        const viewState = this.editorViewState;
        if (viewState.wordWrap === mode && viewState.wordWrapColumn === column) return;
        viewState.wordWrap = mode;
        viewState.wordWrapColumn = column;
        if (mode !== "off") viewState.scrollLeft = 0;
        viewState.ensurePrimaryCursorVisible();
        this.editor.markDirty();
    }

    /** `currentIndex` is the active match, or -1. */
    public setSearchDecorations(matches: IRange[], currentIndex: number): void {
        this.editorViewState.searchMatches = matches;
        this.editorViewState.currentSearchMatchIndex = currentIndex;
        this.editor.markDirty();
    }

    public setMarkerDecorations(decorations: readonly IMarkerDecoration[]): void {
        this.editor.markerDecorations = decorations;
        this.editor.markDirty();
    }

    /** Colors arrive already resolved — the theme is not consulted. */
    public setGutterChangeDecorations(decorations: readonly IGutterChangeDecoration[]): void {
        this.quickDiffGutterChanges = decorations;
        this.applyGutterChanges();
    }

    /** Bars of extension decoration types (`overviewRulerColor`); they don't touch the quick diff set. */
    public setExtensionGutterChangeDecorations(decorations: readonly IGutterChangeDecoration[]): void {
        this.extensionGutterChanges = decorations;
        this.applyGutterChanges();
    }

    private applyGutterChanges(): void {
        this.editor.gutterChangeDecorations = [...this.quickDiffGutterChanges, ...this.extensionGutterChanges];
        this.editor.markDirty();
    }

    public setDecorations(decorations: IExternalDecorations): void {
        this.editor.decorations = decorations;
        this.editor.markDirty();
    }

    /** Reloading from disk recreates `EditorElement`, so the ghost text goes away by itself. */
    public setGhostText(ghost: IGhostText | null): void {
        this.editor.setGhostText(ghost);
    }

    /** Cells absent from the document (color decorators); the ghost text keeps its own. */
    public setInlineInsertions(insertions: readonly IInlineInsertion[]): void {
        this.editor.setInlineInsertions(insertions);
    }

    public revealRange(range: IRange): void {
        this.editorViewState.revealRange(range);
        this.editor.markDirty();
    }

    /** Number of logical document lines. */
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

    /** `line`, `column` are 0-based; clamped to the document bounds. */
    public goToPosition(line: number, column = 0): void {
        this.editorViewState.goToPosition(line, column);
        this.editor.markDirty();
    }

    /** The source is a closure over the model's CURRENT language: a language change needs no re-wiring. */
    private attachLanguageConfiguration(): void {
        this.editor.languageConfigurationSource = () => this.languageConfiguration.get(this.model.languageId);
        void this.languageConfiguration.ensureLoaded(this.model.languageId);
    }

    private ensureTokenizerForLanguage(languageId: string): ITokenizationSupport {
        void this.tokenizationRegistry.load(languageId); // fire-and-forget: load() never rejects
        const support = this.tokenizationRegistry.get(languageId);
        if (support === undefined) return new PlainTextTokenizer();
        // The first frame after this mark is the "highlighted frame".
        mark("editor:tokenizer-ready", { languageId });
        return support;
    }

    /**
     * Upstream `tokenizerSyntaxTokenBackend`: no tokenizer for a model too large for tokenization — and no grammar
     * load either; the TextMate pass over 300K+ lines is what the mode exists to avoid. Here not even the store:
     * the view paints plain text without one. The mode is decided at load and only ever turns off, so a model in
     * it has no store to drop: none was built.
     */
    private applyTokenizer(): void {
        if (!this.tooLarge) {
            if (this.tokenStore === null) {
                // The TM token cache subscribes to the document, which outlives the view: without
                // dispose the subscription would stay on the model after the tab is closed.
                const store = new DocumentTokenStore(
                    this.model.document,
                    this.ensureTokenizerForLanguage(this.model.languageId),
                );
                this.tokenStore = store;
                this.editorViewState.tokenStore = store;
                this.tokenStoreSubscription = store.onDidChangeTokens(({ fromLine, toLine }) => {
                    this.editor.handleTokensChanged(fromLine, toLine);
                });
            } else {
                this.tokenStore.setTokenizationSupport(this.ensureTokenizerForLanguage(this.model.languageId));
            }
        }
        this.editor.markDirty();
    }

    private disposeTokenStore(): void {
        this.tokenStoreSubscription?.dispose();
        this.tokenStoreSubscription = null;
        this.tokenStore?.dispose();
        this.tokenStore = null;
        this.editorViewState.tokenStore = undefined;
    }

    /**
     * Upstream `triggerFoldingModelChanged`: the in-flight request is cancelled at once (its reply
     * would describe the text before the edit; the regions on screen are shifted by the edit instead),
     * the recompute waits out the delay from the LAST trigger. The document fires
     * `onDidChangeContent` mid-edit, BEFORE the view state shifts the regions; by the time the
     * recompute runs they are shifted.
     */
    private scheduleFoldingRecompute(): void {
        this.foldingRequest.cancel();
        this.foldingScheduler.schedule(this.foldingDebounce.get(this.model.uri.toString()));
    }

    /**
     * Provider regions are merged on top of indentation folds rather than replacing them.
     * With a provider, the current regions stay until it replies, as upstream does:
     * an intermediate indentation apply would fold a Java method with a multi-line
     * signature by its parameters only — the body would flicker on every keystroke.
     * So the indentation pass (every line of the file) runs only once the provider has replied.
     */
    private recomputeFoldingRegions(): void {
        this.foldingScheduler.cancel();
        // The view's owner sets the regions: an automatic recompute would overwrite them, and its
        // reveal would break the synced scrolling of the diff sides.
        if (this.foldingOwnedExternally) return;
        // Upstream `FoldingController.onModelChanged`: no folding model for a model too large for tokenization.
        // The mode is decided before the component exists and only ever ends, so nothing is in flight
        // and no regions were applied: there is nothing to cancel or clear.
        if (this.tooLarge) return;
        // Snapshot which start lines are collapsed BEFORE the request: the user
        // may fold while it is in flight, the apply unions both.
        const collapsedStarts = this.collapsedStartLines();
        const started = Date.now();

        // Every recompute supersedes the in-flight request — even one that found no
        // providers: a late reply from a removed provider must not come back.
        const ticket = this.foldingRequest.start();
        const providers = this.foldingProviders.ordered(this.model);
        if (providers.length === 0) {
            this.applyFoldingRegions(this.computeIndentationFolds(), collapsedStarts);
            this.foldingDebounce.update(this.model.uri.toString(), Date.now() - started);
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
            this.applyFoldingRegions(
                mergeFoldingRegions(this.computeIndentationFolds(), providerRegions),
                collapsedStarts,
            );
            // As upstream, the provider's round trip counts: a slow one is asked less often.
            this.foldingDebounce.update(this.model.uri.toString(), Date.now() - started);
        });
    }

    private computeIndentationFolds(): IFoldingRegion[] {
        return computeIndentationFolds(this.model.document, this.editorViewState.tabSize);
    }

    /** `editor.foldingMaximumRegions`; a change recomputes, as upstream `onModelChanged` does. */
    public setFoldingMaximumRegions(limit: number): void {
        if (this.foldingMaximumRegions === limit) return;
        this.foldingMaximumRegions = limit;
        this.scheduleFoldingRecompute();
    }

    private collapsedStartLines(): Set<number> {
        const starts = new Set<number>();
        for (const region of this.editorViewState.foldedRegions) {
            if (region.isCollapsed) starts.add(region.startLine);
        }
        return starts;
    }

    /**
     * `priorCollapsed` is unioned with the currently collapsed regions — a fold made before
     * the recompute survives an intermediate empty apply.
     */
    private applyFoldingRegions(computed: IFoldingRegion[], priorCollapsed: ReadonlySet<number>): void {
        const regions = limitFoldingRegions(computed, this.foldingMaximumRegions);
        const collapsedStarts = this.collapsedStartLines();
        for (const start of priorCollapsed) collapsedStarts.add(start);
        for (const region of regions) {
            if (collapsedStarts.has(region.startLine)) region.isCollapsed = true;
        }
        this.editorViewState.setFoldingRegions(regions);
        // The recompute may have folded a region around the edited line (Tab moved it into a
        // collapsed block) — keep the cursor visible, as upstream does.
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
