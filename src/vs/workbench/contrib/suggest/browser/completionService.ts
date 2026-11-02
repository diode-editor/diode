import type { CompletionDetailsContent } from "@tuidom/elements/completionlist/completionDetailsElement";
import type { CompletionListItem } from "@tuidom/elements/completionlist/completionListElement";

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable, MutableDisposable } from "../../../../base/common/lifecycle.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection, isSelectionCollapsed } from "../../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type {
    CompletionItemProvider,
    ICoreCompletionItem,
    ICoreResolvedCompletion,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import { CompletionTriggerKind } from "../../../../editor/common/languages/iCompletionSource.ts";
import { type StandardTokenType, standardTokenTypeAt } from "../../../../editor/common/languages/standardTokenType.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { SUGGEST_DETAILS_VISIBLE_STATE } from "../../../common/stateKeys.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { FocusTracker } from "../../../services/focus/browser/focusTracker.ts";
import { FocusTrackerDIToken } from "../../../services/focus/browser/focusTracker.ts";

import { collectWordCompletions } from "./collectWordCompletions.ts";
import { type ICompletionsFromProviders, provideCompletions } from "./provideCompletions.ts";
import {
    type IQuickSuggestionsOptions,
    readQuickSuggestions,
    shouldAutoTrigger,
    valueFor,
} from "./quickSuggestions.ts";
import type { SuggestComponent } from "./suggestComponent.ts";
import { SuggestComponentDIToken } from "./suggestComponent.ts";

export const CompletionServiceDIToken = token<CompletionService>("CompletionService");

/**
 * Letters of any script, like upstream `DEFAULT_WORD_REGEXP`: with ASCII `\w`, quick suggest flickered
 * on Cyrillic — it opened with an empty prefix and closed on the very next letter.
 */
const WORD_CHAR = /[\p{L}\p{M}\p{N}_.-]/u;

/** `CompletionItemKind.Text` — for word-based items. */
const KIND_TEXT = 0;

/** How long to wait for resolve before inserting (auto-import edits). */
const ACCEPT_RESOLVE_TIMEOUT_MS = 300;

/** Like upstream `_waitForInlineCompletionsAndTrigger`. */
const INLINE_COMPLETIONS_WAIT_MS = 750;

/**
 * Upstream `product.defaultChatAgent.completionsEnablementSetting`: in `offWithInlineSuggestions`
 * mode it turns off buffer words.
 */
const COMPLETIONS_ENABLEMENT_SETTING = "github.copilot.enable";

/**
 * What upstream `SuggestModel` reads from `InlineCompletionsController`. The ghost text service itself
 * depends on {@link CompletionService}, so it is registered here rather than injected.
 */
export interface IInlineSuggestionsState {
    isVisible(): boolean;
    /** The request is debounced or in flight. */
    isLoading(): boolean;
    stopAutomatic(): void;
    readonly onDidChange: Event<void>;
}

const EMPTY_RESULT: ICompletionsFromProviders = { items: [], isIncomplete: false, providerOf: new Map() };

export class CompletionService extends Disposable implements IContextKeyContributor {
    private readonly onDidCloseEmitter = this.register(new Emitter<void>());
    private readonly onDidShowEmitter = this.register(new Emitter<void>());
    public static dependencies = [
        SuggestComponentDIToken,
        EditorServiceDIToken,
        CommandRegistryDIToken,
        StateServiceDIToken,
        FocusTrackerDIToken,
        LanguageFeaturesServiceDIToken,
        IConfigurationServiceDIToken,
    ] as const;

    private readonly component: SuggestComponent;
    private readonly group: IEditorService;
    private readonly commands: CommandRegistry;
    private readonly state: IStateService;
    private readonly languageFeatures: ILanguageFeaturesService;
    private readonly configuration: IConfigurationService;
    private inlineSuggestions: IInlineSuggestionsState | null = null;
    private readonly waitForInline = this.register(new MutableDisposable<DisposableStore>());
    private activeEditor: TextEditorPane | null = null;
    private prefixRange: IRange | null = null;
    // The provider set the prefix boundary — don't recompute it on further typing (refilterOpen).
    private prefixFromProvider = false;
    // The popup was opened by something other than an explicit command (typing, trigger character).
    // Stryker disable next-line BooleanLiteral: the value is not read before the first trigger() — refilterOpen runs only with the popup open, and trigger() opens it and sets the field
    private autoSession = false;
    // The provider `range` is a snapshot of this same position: it tells how much was typed since the trigger.
    private triggerCaret: IPosition | null = null;
    // `null` means no requests yet; see cancelRequestIfCaretLeft.
    private requestCaret: IPosition | null = null;

    // Quick suggest, a trigger character request or a re-request of an incomplete list — which one
    // lives in pendingAutoSuggest (their delays differ).
    private readonly autoSuggest = this.register(
        new RunOnceScheduler(() => {
            this.pendingAutoSuggest?.();
        }, 0),
    );
    // `null` until the first scheduleAuto; the scheduler fires only after it.
    private pendingAutoSuggest: (() => void) | null = null;
    private readonly latest = new LatestRequest();
    // The server filtered the list by the prefix — further typing must re-request, not narrow locally.
    private isIncomplete = false;
    private providerOf: ReadonlyMap<ICoreCompletionItem, CompletionItemProvider> = new Map();
    // Keyed by the item id at its source.
    private readonly resolvedItems = new Map<string, ICoreResolvedCompletion>();
    private readonly pendingResolves = new Map<string, Promise<ICoreResolvedCompletion | null>>();

    public constructor(
        component: SuggestComponent,
        group: IEditorService,
        commands: CommandRegistry,
        state: IStateService,
        focusTracker: FocusTracker,
        languageFeatures: ILanguageFeaturesService,
        configuration: IConfigurationService,
    ) {
        super();
        this.configuration = configuration;
        this.component = component;
        this.group = group;
        this.commands = commands;
        this.state = state;
        this.languageFeatures = languageFeatures;
        this.component.view.onAccept = (item) => {
            this.accept(item);
        };
        this.component.view.onSelectionChanged = (item) => {
            this.showDetailsFor(item);
        };
        this.component.detailsVisible = this.state.get(SUGGEST_DETAILS_VISIBLE_STATE);
        // Keyboard focus loss (Ctrl+Tab, Quick Open): an in-flight response would raise the popup
        // under someone else's focus. Click focus is already covered by `close-on-outside`.
        this.register(
            focusTracker.onDidChangeFocus((active) => {
                if (!(active instanceof EditorElement)) this.close();
            }),
        );

        // The unconditional close() on editor change also cancels a pending auto suggest.
        this.register(
            bindActiveEditor(this.group, (editor, store) => {
                this.close();
                if (editor === null) return;
                store.add(
                    editor.onDidChangeCursorPosition(() => {
                        this.onCaretChanged(editor);
                    }),
                );
                store.add(
                    editor.onDidType((text) => {
                        this.onDidType(editor, text);
                    }),
                );
            }),
        );
    }

    /**
     * `auto` — quick suggest: like upstream, the popup is not shown if nothing matches the typed text,
     * and closes once further typing filters the list down to nothing.
     */
    public async trigger(triggerCharacter?: string, auto = false): Promise<void> {
        this.cancelAutoSuggest();
        const editor = this.group.getActiveEditor();
        if (editor === null) return;

        // Multi-cursor is unsupported: accept would insert the edit past the other cursors and collapse them.
        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) return;

        const active = selections[0].active;

        const providers = this.languageFeatures.completionProvider.ordered(editor);
        const ticket = this.latest.start();
        this.requestCaret = active;
        // No response deadline (like upstream): a language server on a cold start takes seconds, and an
        // open popup won't re-request. The ticket drops a stale response.
        const result =
            // Stryker disable next-line ConditionalExpression: provideCompletions([]) gives the same empty result — the branch only avoids a pointless aggregator call
            providers.length === 0
                ? EMPTY_RESULT
                : await provideCompletions(
                      providers,
                      {
                          uri: editor.uri.toString(),
                          languageId: editor.languageId,
                          versionId: editor.model.document.versionId,
                          line: active.line,
                          character: active.character,
                          triggerKind:
                              triggerCharacter !== undefined
                                  ? CompletionTriggerKind.TriggerCharacter
                                  : CompletionTriggerKind.Invoke,
                          // Stryker disable next-line ConditionalExpression: the request goes over RPC as JSON, which drops undefined fields — `{triggerCharacter: undefined}` is indistinguishable from absence for the provider
                          ...(triggerCharacter !== undefined ? { triggerCharacter } : {}),
                      },
                      ticket.token,
                  );
        if (ticket.isStale()) return;

        // The word may have grown while we waited: the list narrows to what is typed, not to the request snapshot.
        const caret = editor.viewState.selections[0].active;

        // The server filtered an incomplete list by the prefix at request time — it can't be narrowed locally
        // (gopls gives all items one `filterText`): re-request, like upstream `_onNewContext`.
        if (result.isIncomplete && caret.character > active.character) {
            void this.trigger(undefined, auto);
            return;
        }
        const caretLine = editor.viewState.document.getLineContent(caret.line);

        const extensionItems = result.items;
        // The provider sets the prefix boundary: after `d.` its `range` starts past the dot, while our
        // wordStart (WORD_CHAR includes `.` and `-` for settings.json) would give the prefix `d.`.
        const providerStart = commonPrefixStart(extensionItems, active);
        const prefixStart = providerStart ?? wordStart(caretLine, caret.character);
        const prefix = caretLine.slice(prefixStart, caret.character);

        // Upstream's word provider is registered for `*`, in the last group of `orderedGroups`, and
        // `provideSuggestionItems` stops at the first group with results: words only when no provider has any.
        const items = extensionItems.length > 0 ? extensionItems : this.wordItems(editor, prefix);
        if (items.length === 0) return;

        const anchor = editor.getCaretAnchor();
        if (anchor === null) return;

        this.activeEditor = editor;
        this.prefixRange = createRange(caret.line, prefixStart, caret.line, caret.character);
        this.prefixFromProvider = providerStart !== null;
        // Snapshot of the request cursor, not the current one: accept counts the characters typed since from it (resolveAcceptRange).
        this.triggerCaret = { line: active.line, character: active.character };
        this.isIncomplete = result.isIncomplete;
        this.providerOf = result.providerOf;
        this.autoSession = auto;

        const view = this.component.view;
        view.setItems(items.map(toListItem));
        view.setFilter(prefix);
        if (view.items.length === 0) {
            // An auto request with no matches shows no popup (upstream: "nothing left" → cancel), otherwise any
            // word would open the whole list of buffer words.
            if (auto) {
                this.close();
                return;
            }
            view.setFilter("");
        }

        // The popup does not take focus — like VS Code.
        const wasOpen = this.isOpen();
        this.component.openAt(anchor);
        if (!wasOpen) this.onDidShowEmitter.fire();
    }

    public close(): void {
        // Fire only for an open popup: close() is called liberally (bindEditor — unconditionally).
        const wasOpen = this.isOpen();
        this.cancelAutoSuggest();
        this.component.close();
        this.activeEditor = null;
        this.prefixRange = null;
        this.prefixFromProvider = false;
        this.triggerCaret = null;
        this.isIncomplete = false;
        this.latest.cancel();
        if (wasOpen) {
            this.onDidCloseEmitter.fire();
        }
    }

    /** Doesn't fire if the popup was already closed. */
    public readonly onDidClose = this.onDidCloseEmitter.event;

    /**
     * Ghost text leaves the screen meanwhile: in upstream, with the widget open, ghost text is only
     * the continuation of the selected item.
     */
    public readonly onDidShow = this.onDidShowEmitter.event;

    public setInlineSuggestionsState(state: IInlineSuggestionsState): IDisposable {
        this.inlineSuggestions = state;
        return {
            dispose: () => {
                if (this.inlineSuggestions === state) this.inlineSuggestions = null;
            },
        };
    }

    public isOpen(): boolean {
        return this.component.isOpen();
    }

    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("suggestWidgetVisible", this.isOpen());
    }

    public selectNext(): void {
        this.component.view.selectNext();
    }

    public selectPrevious(): void {
        this.component.view.selectPrevious();
    }

    public selectNextPage(): void {
        this.component.view.selectNextPage();
    }

    public selectPreviousPage(): void {
        this.component.view.selectPreviousPage();
    }

    public acceptSelected(): void {
        const item = this.component.view.getSelectedItem();
        if (item !== null) this.accept(item);
    }

    public hide(): void {
        this.close();
    }

    /** The choice survives a restart: it is the user's habit, not a property of the project. */
    public toggleDetails(): void {
        const next = !this.component.detailsVisible;
        this.component.detailsVisible = next;
        this.state.store(SUGGEST_DETAILS_VISIBLE_STATE, next);
        // Collapsing changes the popup width — the position must be recomputed.
        this.component.refreshDetailsLayout();
        // The selected item's description may not have been requested yet.
        if (next) this.showDetailsFor(this.component.view.getSelectedItem());
    }

    private onCaretChanged(editor: TextEditorPane): void {
        if (!this.isOpen()) {
            this.cancelRequestIfCaretLeft(editor);
            return;
        }
        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) {
            this.close();
            return;
        }
        const active = selections[0].active;
        this.refilterOpen(editor, active, editor.viewState.document.getLineContent(active.line));
    }

    /**
     * The request matters while the cursor continues its word (upstream `_onNewContext`): there is no
     * response deadline, and a slow server's response would raise the popup where the user left long ago.
     */
    private cancelRequestIfCaretLeft(editor: TextEditorPane): void {
        const from = this.requestCaret;
        if (from === null) return;
        const selections = editor.viewState.selections;
        if (selections.length === 1 && isSelectionCollapsed(selections[0])) {
            const active = selections[0].active;
            const line = editor.viewState.document.getLineContent(active.line);
            if (
                active.line === from.line &&
                active.character >= from.character &&
                isWordRun(line.slice(from.character, active.character))
            ) {
                return;
            }
        }
        this.latest.cancel();
    }

    /**
     * A typing event, not "the line grew": accept, undo and paste don't count. Arrives AFTER the
     * cursor event of the same edit. A trigger character reopens the list even with the popup open.
     */
    private onDidType(editor: TextEditorPane, text: string): void {
        if (this.isTriggerCharacterCase(editor, text)) {
            if (!this.canShowSuggestWithInline(editor.languageId)) return;
            if (this.isOpen()) this.component.close();
            // The in-flight response is about the word before the character.
            this.latest.cancel();
            // On the next tick, outside the edit stack (upstream — immediately). Not `auto`: our prefix
            // also captures the character (`d.`), and without a provider range nothing would match it.
            this.scheduleAuto(() => void this.trigger(text), 0);
        } else if (!this.isOpen()) {
            this.scheduleQuickSuggest(editor);
        }
    }

    /**
     * upstream `_triggerCharacterListener`: the character is declared by a provider of THIS document
     * (TypeScript's "." doesn't open the popup in markdown); a letter continuing a word goes the quick
     * suggest path.
     */
    private isTriggerCharacterCase(editor: TextEditorPane, text: string): boolean {
        const triggers = this.languageFeatures.completionProvider
            .ordered(editor)
            .flatMap((provider) => provider.triggerCharacters);
        if (!triggers.includes(text)) return false;
        if (!this.configuration.get("editor.suggestOnTriggerCharacters", { overrideIdentifier: editor.languageId }))
            return false;
        const caret = editor.viewState.selections[0].active;
        return !shouldAutoTrigger(editor.viewState.document.getLineContent(caret.line), caret.character);
    }

    private refilterOpen(editor: TextEditorPane, active: IPosition, line: string): void {
        const prefixRange = this.prefixRange;
        // Unreachable: trigger() sets prefixRange together with opening, close() clears it.
        /* v8 ignore start -- defensive: see above */
        // Stryker disable next-line ConditionalExpression,BlockStatement: unreachable branch, see above
        if (prefixRange === null) {
            this.close();
            return;
        }
        /* v8 ignore stop */
        if (active.line !== prefixRange.start.line || active.character < prefixRange.start.character) {
            this.close();
            return;
        }
        // Further typing must continue the word: otherwise `refineFilter` kept the last non-empty list,
        // `acceptSelectedSuggestion` took Enter, and `cons{` + Enter gave `console`.
        const trigger = this.triggerCaret;
        // Unreachable with the popup open, like prefixRange above; the check narrows the type.
        // Stryker disable next-line ConditionalExpression: unreachable branch, see above
        if (trigger !== null && !isWordRun(line.slice(trigger.character, active.character))) {
            this.close();
            return;
        }
        // Don't recompute the provider boundary: it lies where the core sees no word boundary
        // (a settings.json key quote, a tsserver dot), and recomputing closed the popup on the first character.
        const prefixStart = this.prefixFromProvider ? prefixRange.start.character : wordStart(line, active.character);
        if (prefixStart !== prefixRange.start.character) {
            this.close();
            return;
        }
        const anchor = editor.getCaretAnchor();
        if (anchor === null) {
            this.close();
            return;
        }
        const prefix = line.slice(prefixStart, active.character);
        const view = this.component.view;
        if (this.autoSession && !this.isIncomplete) {
            // An auto popup filtered down to nothing closes; an explicit one keeps the last non-empty list.
            view.setFilter(prefix);
            if (view.items.length === 0) {
                this.close();
                return;
            }
        } else {
            view.refineFilter(prefix);
        }
        this.prefixRange = createRange(prefixRange.start.line, prefixStart, active.line, active.character);
        this.component.setAnchor(anchor);

        // An incomplete list is filtered by the old prefix: show the narrowing right away, but re-request.
        if (this.isIncomplete) {
            const auto = this.autoSession;
            this.scheduleAuto(() => void this.trigger(undefined, auto), 0);
        }
    }

    private scheduleAuto(run: () => void, delayMs: number): void {
        // Stryker disable next-line CallExpression: the previous cycle's wait won't open the popup anyway — new typing changed the document version, which finish checks; we drop it right away so as not to hold a timer and a subscription
        this.waitForInline.clear();
        this.pendingAutoSuggest = run;
        this.autoSuggest.schedule(delayMs);
    }

    private cancelAutoSuggest(): void {
        this.autoSuggest.cancel();
        this.waitForInline.clear();
    }

    private quickSuggestions(languageId: string): IQuickSuggestionsOptions {
        return readQuickSuggestions(
            this.configuration.get("editor.quickSuggestions", { overrideIdentifier: languageId }),
        );
    }

    /** The gates are checked when the timer fires — against the state the user has typed up to by then. */
    private scheduleQuickSuggest(editor: TextEditorPane): void {
        const delay = this.configuration.get("editor.quickSuggestionsDelay", { overrideIdentifier: editor.languageId });
        this.scheduleAuto(() => {
            this.doQuickSuggest(editor);
        }, delay);
    }

    /**
     * In `offWhenInlineCompletions` mode with a live inline provider, waits for ghost text first:
     * if it appears, the popup is not needed.
     */
    private doQuickSuggest(editor: TextEditorPane): void {
        // Scheduling happens only with the popup closed; a response in flight may have opened it since.
        if (this.isOpen()) return;
        // Guards against a silent editor change with no event (with an event, close cancels the schedule).
        if (this.group.getActiveEditor() !== editor) return;
        // A selection and multi-cursor are cut off by trigger() and by the wait's finish.
        const caret = editor.viewState.selections[0].active;
        if (!shouldAutoTrigger(editor.viewState.document.getLineContent(caret.line), caret.character)) return;

        const languageId = editor.languageId;
        // Upstream skips tokenization when everything is `on`/`off`; here the mode is always
        // looked up — the cursor is in the viewport, so rendering has already tokenized the line.
        const value = valueFor(this.quickSuggestions(languageId), this.tokenTypeBefore(editor, caret));
        if (value === "off" || value === "inline") return;
        const waitForInline =
            value === "offWhenInlineCompletions" &&
            this.languageFeatures.inlineCompletionsProvider.has(editor) &&
            this.configuration.get("editor.inlineSuggest.enabled", { overrideIdentifier: languageId });
        if (!this.canShowSuggestWithInline(languageId)) return;

        if (waitForInline) {
            this.waitForInlineAndTrigger(editor, caret);
        } else {
            void this.trigger(undefined, true);
        }
    }

    /**
     * The character left of the cursor, like upstream (`column - 2`). Tokenization is only topped up
     * cheaply (`tokenizeIfCheap`): a full pass up to the cursor in a large file costs seconds per keystroke.
     */
    private tokenTypeBefore(editor: TextEditorPane, caret: IPosition): StandardTokenType {
        const store = editor.viewState.tokenStore;
        store?.tokenizeIfCheap(caret.line);
        return standardTokenTypeAt(store?.getLineTokens(caret.line), Math.max(caret.character - 1, 0));
    }

    /** No ghost text — allowed; with ghost text, `editor.inlineSuggest.suppressSuggestions` decides. */
    private canShowSuggestWithInline(languageId: string): boolean {
        if (this.inlineSuggestions?.isVisible() !== true) return true;
        return !this.configuration.get("editor.inlineSuggest.suppressSuggestions", { overrideIdentifier: languageId });
    }

    /**
     * upstream `_waitForInlineCompletionsAndTrigger`. No answer within {@link INLINE_COMPLETIONS_WAIT_MS} —
     * the popup opens and the ghost text request is abandoned; if the text or cursor moved, it's another cycle.
     */
    private waitForInlineAndTrigger(editor: TextEditorPane, caret: IPosition): void {
        const inline = this.inlineSuggestions;
        if (inline === null) {
            void this.trigger(undefined, true);
            return;
        }
        const versionId = editor.model.document.versionId;
        const store = new DisposableStore();
        this.waitForInline.value = store;
        // Ghost text already on screen — check() ends the wait at once, with no popup.
        const finish = (doTrigger: boolean): void => {
            this.waitForInline.clear();
            if (!doTrigger || this.isOpen()) return;
            const selections = editor.viewState.selections;
            if (
                this.group.getActiveEditor() === editor &&
                editor.model.document.versionId === versionId &&
                // Stryker disable next-line ConditionalExpression: trigger() cuts off multi-cursor itself; the guard avoids reading selections[0] of an empty list
                selections.length === 1 &&
                isSelectionCollapsed(selections[0]) &&
                selections[0].active.line === caret.line &&
                selections[0].active.character === caret.character
            ) {
                void this.trigger(undefined, true);
            }
        };
        const check = (): void => {
            if (inline.isVisible()) {
                finish(false);
            } else if (!inline.isLoading()) {
                finish(true);
            }
        };
        const timer = setTimeout(() => {
            finish(true);
            inline.stopAutomatic();
        }, INLINE_COMPLETIONS_WAIT_MS);
        store.add({
            dispose: () => {
                clearTimeout(timer);
            },
        });
        store.add(inline.onDidChange(check));
        check();
    }

    /** Which documents to take words from follows `editor.wordBasedSuggestions` (upstream `WordBasedCompletionItemProvider`). */
    private wordItems(editor: TextEditorPane, prefix: string): ICoreCompletionItem[] {
        const languageId = editor.languageId;
        const mode = this.configuration.get("editor.wordBasedSuggestions", { overrideIdentifier: languageId });
        if (mode === "off") return [];
        if (
            mode === "offWithInlineSuggestions" &&
            this.languageFeatures.inlineCompletionsProvider.has(editor) &&
            isCompletionsEnabled(this.configuration.get<unknown>(COMPLETIONS_ENABLEMENT_SETTING), languageId)
        ) {
            return [];
        }
        // Upstream computes word completions in the editor worker, which never sees a model above the sync limit;
        // a large file (docs/arch/Editor.md) contributes no words here either — its text may not fit a string.
        if (editor.isTooLargeForTokenization) return [];
        const others = this.group.getEditors().filter((candidate) => {
            // Stryker disable next-line ConditionalExpression,MethodExpression: equivalent — collectWordCompletions dedupes words, so the active document twice changes nothing
            return candidate !== editor && !candidate.isTooLargeForTokenization;
        });
        const sources =
            mode === "currentDocument"
                ? [editor]
                : [
                      editor,
                      ...others.filter((candidate) => mode === "allDocuments" || candidate.languageId === languageId),
                  ];
        const texts = sources.map((source) => source.getText());
        return collectWordCompletions(texts, prefix).map((word) => ({
            label: word,
            insertText: word,
            kind: KIND_TEXT,
        }));
    }

    /**
     * `core.range` is a snapshot at trigger time, while further typing is filtered locally: the range end
     * lags behind the cursor, and accept would leave a tail (`"editor.tabSize"di`). We shift the end by the
     * number of characters typed since — hence only for a single-line range.
     */
    private resolveAcceptRange(core: ICoreCompletionItem, prefixRange: IRange, caret: IPosition): IRange {
        const providerRange = core.range;
        if (providerRange === undefined) return prefixRange;

        const trigger = this.triggerCaret;
        /* v8 ignore start -- defensive: while the popup is open, triggerCaret is set
           (trigger() sets it, close() clears it), and moving the cursor to another line
           closes the popup via refilterOpen — so accept is never reached */
        if (caret.line !== trigger?.line) return providerRange;
        /* v8 ignore stop */
        if (providerRange.end.line !== trigger.line) return providerRange;

        const delta = caret.character - trigger.character;
        if (delta === 0) return providerRange;
        return createRange(
            providerRange.start.line,
            providerRange.start.character,
            providerRange.end.line,
            providerRange.end.character + delta,
        );
    }

    private accept(item: CompletionListItem): void {
        const editor = this.activeEditor;
        const core = item.data as ICoreCompletionItem | undefined;
        const prefixRange = this.prefixRange;
        if (editor === null || core === undefined || prefixRange === null) {
            this.close();
            return;
        }
        // Read the cursor BEFORE close() — resolveAcceptRange compares it with triggerCaret.
        const range = this.resolveAcceptRange(core, prefixRange, editor.viewState.selections[0].active);
        this.close();

        const id = core.id;
        const resolve = this.resolverOf(core);
        // Edits that came in the list itself (gopls) apply right away — upstream doesn't wait
        // for resolve in this case (`suggestController`, "sync additional edits").
        if (core.additionalEdits !== undefined || id === undefined || resolve === undefined) {
            this.applyAccept(editor, range, core, core.additionalEdits ?? []);
            return;
        }
        // The server returns auto-import edits only on resolve, and the details panel is usually hidden.
        // Wait briefly: insertion must not hang on a silent server.
        void this.resolveItem(id, resolve, ACCEPT_RESOLVE_TIMEOUT_MS).then((resolved) => {
            this.applyAccept(editor, range, core, resolved?.additionalEdits ?? []);
        });
    }

    /**
     * The insertion and its companion edits are one transaction (one Undo). The cursor lands at the end of
     * the main insertion, like upstream: `additionalTextEdits` only shift cursors.
     */
    private applyAccept(
        editor: TextEditorPane,
        range: IRange,
        core: ICoreCompletionItem,
        additionalEdits: readonly ITextEdit[],
    ): void {
        // The edit below synchronously calls onCaretChanged — don't let it auto-reopen the popup.
        editor.applyExternalEdits(
            [createTextEdit(range, core.insertText), ...additionalEdits],
            "Accept Completion",
            ([inserted]) => [createCursorSelection(inserted.range.end.line, inserted.range.end.character)],
        );

        const command = core.command;
        if (command !== undefined) {
            // Run after the insertion, outside the current stack (editorconfig's
            // _triggerSuggestAfterDelay reopens the popup).
            queueMicrotask(() => {
                this.commands.execute(command.command, ...(command.arguments ?? []));
            });
        }
    }

    /** No request while the panel is hidden: for a language server it is a request per list movement. */
    private showDetailsFor(item: CompletionListItem | null): void {
        if (!this.component.detailsVisible) return;
        const core = item?.data as ICoreCompletionItem | undefined;
        if (core === undefined) {
            this.component.setDetailsContent(null);
            return;
        }
        this.component.setDetailsContent(detailsContent(core, this.resolvedItems.get(core.id ?? "")));

        const id = core.id;
        if (id === undefined) return;
        const resolve = this.resolverOf(core);
        // Stryker disable next-line ConditionalExpression: without the check `resolve(id)` throws from an unawaited promise — the runner crashes on an unhandled error instead of a test failing (see docs/MUTATION.md#раннер-упал-на-мутанте--тоже-не-проверено-и-это-почти-всегда-наш-код); the "provider without resolve" branch is covered by the test of a source without a resolver
        if (resolve === undefined) return;
        // Caching and merging of parallel requests live inside resolveItem; don't
        // duplicate the check here, or its branch becomes dead.
        void this.resolveItem(id, resolve).then((resolved) => {
            if (resolved === null) return;
            // The user may have moved to another item while the description was fetched.
            const selected = this.component.view.getSelectedItem()?.data as ICoreCompletionItem | undefined;
            if (selected?.id !== id) return;
            this.component.setDetailsContent(detailsContent(core, resolved));
        });
    }

    /** `undefined` — the provider can't resolve. */
    private resolverOf(
        core: ICoreCompletionItem,
    ): ((id: string) => Promise<ICoreResolvedCompletion | null>) | undefined {
        const provider = this.providerOf.get(core);
        return provider?.resolveCompletionItem?.bind(provider);
    }

    /** The result is cached; parallel requests for one id merge into one RPC. */
    private async resolveItem(
        id: string,
        resolve: (id: string) => Promise<ICoreResolvedCompletion | null>,
        timeoutMs?: number,
    ): Promise<ICoreResolvedCompletion | null> {
        const cached = this.resolvedItems.get(id);
        if (cached !== undefined) return cached;

        let pending = this.pendingResolves.get(id);
        if (pending === undefined) {
            // Stryker disable next-line ArrowFunction: `undefined` instead of `null` is indistinguishable downstream — it doesn't enter the cache (get returns the same undefined), and consumers read the result via `?.`
            pending = resolve(id).catch(() => null);
            this.pendingResolves.set(id, pending);
            void pending.then((resolved) => {
                this.pendingResolves.delete(id);
                if (resolved !== null) this.resolvedItems.set(id, resolved);
            });
        }
        if (timeoutMs === undefined) return pending;
        // Race with a timeout only on the accept path: a buffer edit waits behind it,
        // and "the server is thinking" must not read as a hang.
        return Promise.race([
            pending,
            new Promise<null>((resolve) => {
                setTimeout(() => {
                    resolve(null);
                }, timeoutMs);
            }),
        ]);
    }
}

/** upstream `isCompletionsEnabledFromObject`: the language key beats `"*"`; not an object — disabled. */
function isCompletionsEnabled(setting: unknown, languageId: string): boolean {
    if (typeof setting !== "object" || setting === null || Array.isArray(setting)) return false;
    const byLanguage = setting as Readonly<Record<string, unknown>>;
    if (byLanguage[languageId] !== undefined) return Boolean(byLanguage[languageId]);
    return Boolean(byLanguage["*"]);
}

/** An empty run is a "word" too. */
function isWordRun(text: string): boolean {
    for (const char of text) {
        if (!WORD_CHAR.test(char)) return false;
    }
    return true;
}

function wordStart(line: string, character: number): number {
    let start = Math.min(character, line.length);
    while (start > 0 && WORD_CHAR.test(line[start - 1])) start--;
    return start;
}

/** The items' common `range.start.character`; `null` — no ranges, or they differ. */
function commonPrefixStart(items: readonly ICoreCompletionItem[], caret: IPosition): number | null {
    let start: number | null = null;
    for (const item of items) {
        const range = item.range;
        if (range === undefined) continue;
        if (range.start.line !== caret.line || range.start.character > caret.character) return null;
        if (start === null) {
            start = range.start.character;
        } else if (start !== range.start.character) {
            return null;
        }
    }
    return start;
}

/** `labelDetail` is preferred over `detail`: in LSP it is a compact signature, while `detail` can be a paragraph. */
function detailsContent(core: ICoreCompletionItem, resolved?: ICoreResolvedCompletion): CompletionDetailsContent {
    const detail = resolved?.detail ?? core.detail ?? core.labelDetail;
    const documentation = resolved?.documentation ?? core.documentation;
    return {
        ...(detail !== undefined && detail !== "" ? { detail } : {}),
        ...(documentation !== undefined && documentation !== "" ? { documentation } : {}),
    };
}

function toListItem(core: ICoreCompletionItem): CompletionListItem {
    return {
        label: core.label,
        ...(core.detail !== undefined ? { detail: core.detail } : {}),
        ...(core.labelDetail !== undefined ? { labelDetail: core.labelDetail } : {}),
        ...(core.kind !== undefined ? { kind: core.kind } : {}),
        ...(core.filterText !== undefined ? { filterText: core.filterText } : {}),
        ...(core.sortText !== undefined ? { sortText: core.sortText } : {}),
        data: core,
    };
}
