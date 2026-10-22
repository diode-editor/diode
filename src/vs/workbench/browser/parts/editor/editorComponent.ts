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

// On a shared start line the provider region wins (it is more precise); sorted by
// startLine because the folding model and the gutter expect that.
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
    private tokenStore: DocumentTokenStore;
    /** Lives on the component, not the view state: the latter is recreated when the document is reloaded. */
    private indentConfiguration: IIndentConfiguration = {};
    private foldingRecomputeScheduled = false;
    private readonly foldingProviders: LanguageFeatureRegistry<FoldingRangeProvider>;
    private backgroundTokenValue: WorkbenchColorKey = DEFAULT_BACKGROUND_TOKEN;
    /** Regions are set by the view's owner (the diff pane); set this before the first recompute. */
    public foldingOwnedExternally = false;
    /** Guards the sync-indentation ↔ async-provider race: a late reply to a superseded request is dropped. */
    private readonly foldingRequest = new LatestRequest();
    private componentDisposed = false;
    /**
     * Two independent producers: quick diff (git) and extension decoration types. Each one replaces only
     * its own set — otherwise an extension clearing its bars on every keystroke wipes the git bars until the
     * next quick diff recompute (flicker while typing).
     */
    private quickDiffGutterChanges: readonly IGutterChangeDecoration[] = [];
    private extensionGutterChanges: readonly IGutterChangeDecoration[] = [];
    private readonly editTargetValue: ITextEditTarget;
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
    ) {
        super();
        this.foldingProviders = foldingProviders;

        this.model = model;
        this.tokenizationRegistry = tokenizationRegistry;
        this.tokenStyleResolver = tokenStyleResolver;
        this.languageConfiguration = languageConfiguration;

        this.editorViewState = new EditorViewState(model.document);
        // The TM token cache subscribes to the document, which outlives the view: without
        // dispose the subscription would stay on the model after the tab is closed.
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
        // One undo history per document; rebuildForReloadedDocument repeats the same assignment.
        this.editor.undoManager = model.undoManager;
        this.attachSelectionForwarding();
        this.attachTypeForwarding();
        this.view = new ScrollBarDecorator(this.editor);
        // The `editor.scrollbarMarkers` default, for surfaces the configuration never reaches.
        this.view.markerPlacement = "auto";
        if (semanticTokens !== undefined) this.attachSemanticTokens(semanticTokens);

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
        // A grammar may be registered after the file is already open.
        this.register(
            tokenizationRegistry.onDidChange((languageId) => {
                if (languageId === this.model.languageId) this.applyTokenizer();
            }),
        );
        // Recompute on every registration, not only on the "none ↔ some" transition.
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
        const before = { tabSize: this.editorViewState.tabSize, insertSpaces: this.editorViewState.insertSpaces };
        this.indentConfiguration = config;
        this.applyIndentConfigurationToViewState();
        this.editor.markDirty();
        this.notifyIndentIfChanged(before);
    }

    private applyIndentConfigurationToViewState(): void {
        const { insertSpaces, detectIndentation } = this.indentConfiguration;
        // A non-positive `tabSize` is treated as a missing key.
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

    private applyTokenizer(): void {
        this.tokenStore.setTokenizationSupport(this.ensureTokenizerForLanguage(this.model.languageId));
        this.editor.markDirty();
    }

    /**
     * On a microtask: the document fires `onDidChangeContent` mid-edit, BEFORE the view state
     * shifts the regions, and the recompute must see them already shifted.
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
     * Provider regions are merged on top of indentation folds rather than replacing them.
     * With a provider, the current regions stay until it replies, as upstream does:
     * an intermediate indentation apply would fold a Java method with a multi-line
     * signature by its parameters only — the body would flicker on every keystroke.
     */
    private recomputeFoldingRegions(): void {
        // The view's owner sets the regions: an automatic recompute would overwrite them, and its
        // reveal would break the synced scrolling of the diff sides.
        if (this.foldingOwnedExternally) return;
        // Snapshot which start lines are collapsed BEFORE the request: the user
        // may fold while it is in flight, the apply unions both.
        const collapsedStarts = this.collapsedStartLines();
        const indentation = computeIndentationFolds(this.model.document, this.editorViewState.tabSize);

        // Every recompute supersedes the in-flight request — even one that found no
        // providers: a late reply from a removed provider must not come back.
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
     * `priorCollapsed` is unioned with the currently collapsed regions — a fold made before
     * the recompute survives an intermediate empty apply.
     */
    private applyFoldingRegions(regions: IFoldingRegion[], priorCollapsed: ReadonlySet<number>): void {
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
