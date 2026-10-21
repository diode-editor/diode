import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection, isSelectionCollapsed } from "../../../../editor/common/core/iSelection.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ICoreInlineCompletionItem } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { CompletionService } from "../../suggest/browser/completionService.ts";
import { CompletionServiceDIToken } from "../../suggest/browser/completionService.ts";

import { provideInlineCompletions } from "./provideInlineCompletions.ts";

export const InlineCompletionsServiceDIToken = token<InlineCompletionsService>("InlineCompletionsService");

/**
 * Ghost text is the tail of `insertText` past what is typed: matching typing shrinks the suggestion
 * locally, Backspace grows it back, a mismatch dismisses it.
 */
interface IInlineSession {
    readonly editor: TextEditorPane;
    readonly line: number;
    /** Start of the replaced range: the provider's `range.start` or the request cursor. */
    readonly startCharacter: number;
    readonly insertText: string;
}

/**
 * Settings are read on EVERY access, not cached: an edit to `settings.json` applies without a
 * restart.
 */
export class InlineCompletionsService extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        EditorServiceDIToken,
        CompletionServiceDIToken,
        IConfigurationServiceDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    private readonly group: IEditorService;
    private readonly completionService: CompletionService;
    private readonly configuration: IConfigurationService;
    private readonly languageFeatures: ILanguageFeaturesService;

    private session: IInlineSession | null = null;
    // A "shown / awaiting answer" change — quick suggest waits for it (offWhenInlineCompletions).
    private readonly onDidChangeStateEmitter = this.register(new Emitter<void>());
    // Stryker disable next-line BooleanLiteral: the initializer value is never read — show() overwrites the field before a session exists, hide() resets it to true
    private indentationLessThanTabSize = true;

    private readonly autoTrigger = this.register(
        new RunOnceScheduler(() => {
            void this.trigger(InlineCompletionTriggerKind.Automatic);
        }, 0),
    );
    // Cancelling the ticket also stops the provider's work via the token: a suggestion may be backed
    // by a paid LLM call.
    private readonly latest = new LatestRequest();
    // The accept edit must not re-request a suggestion by itself.
    private suppressAutoTriggerOnce = false;

    public constructor(
        group: IEditorService,
        completionService: CompletionService,
        configuration: IConfigurationService,
        languageFeatures: ILanguageFeaturesService,
    ) {
        super();
        this.group = group;
        this.completionService = completionService;
        this.configuration = configuration;
        this.languageFeatures = languageFeatures;

        this.register(
            bindActiveEditor(this.group, (editor, store) => {
                this.hide();
                if (editor === null) return;
                // "Content was edited" marker: set by the content listener, consumed by the
                // cursor handler (the view state is consistent there).
                let contentDidChange = false;
                store.add(
                    editor.onDidChangeContent(() => {
                        contentDidChange = true;
                    }),
                );
                store.add(
                    editor.onDidChangeCursorPosition(() => {
                        const wasEdit = contentDidChange;
                        contentDidChange = false;
                        this.onCaretChanged(wasEdit);
                    }),
                );
            }),
        );
        // Under the suggest popup the ghost text is not drawn, but the session lives on: in upstream,
        // with the widget open, ghost text only continues the selected item.
        this.register(
            this.completionService.onDidShow(() => {
                this.session?.editor.setGhostText(null);
                this.onDidChangeStateEmitter.fire();
            }),
        );
        // The popup closed — a still-valid session comes back without a re-request (as upstream);
        // otherwise re-request via the scheduler, not a direct trigger, so the gates are re-checked.
        this.register(
            this.completionService.onDidClose(() => {
                const session = this.session;
                if (session !== null && this.validCaretForSession(session, this.group.getActiveEditor()) !== null) {
                    this.show(session);
                    return;
                }
                this.clearSession();
                this.scheduleAutoTrigger();
            }),
        );
        this.register(
            this.completionService.setInlineSuggestionsState({
                isVisible: () => this.isOpen(),
                isLoading: () => this.autoTrigger.isScheduled() || this.latest.pending,
                stopAutomatic: () => {
                    this.hide();
                },
                onDidChange: this.onDidChangeStateEmitter.event,
            }),
        );
        this.register({
            dispose: () => {
                this.hide();
            },
        });
    }

    /** An open suggest popup hides the session. */
    public isOpen(): boolean {
        return this.session !== null && !this.completionService.isOpen();
    }

    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("inlineSuggestionVisible", this.isOpen());
        contextKeys.set("inlineSuggestionRequestPending", this.isRequestPending());
        contextKeys.set("inlineSuggestionHasIndentationLessThanTabSize", this.hasIndentationLessThanTabSize());
    }

    /**
     * Needed by Escape: while there is no ghost text `inlineSuggestionVisible` is false, yet `.hide`
     * must cancel an unfinished request.
     */
    private isRequestPending(): boolean {
        return this.latest.pending;
    }

    private hasIndentationLessThanTabSize(): boolean {
        // The field resets to true together with the session (hide): "session === null, field false" is unreachable.
        // Stryker disable next-line ConditionalExpression,LogicalOperator: see above
        return this.session === null || this.indentationLessThanTabSize;
    }

    /**
     * Shown in the MIDDLE of a line too: the render splices in phantom columns, the rest of the line
     * shifts right. Under an open suggest popup the answer waits invisibly for it to close (as upstream).
     * `enabled: false` only stops the auto request — an explicit `Invoke` goes through.
     */
    public async trigger(triggerKind: InlineCompletionTriggerKind = InlineCompletionTriggerKind.Invoke): Promise<void> {
        try {
            await this.request(triggerKind);
        } finally {
            // Any outcome ends the wait for quick suggest.
            this.onDidChangeStateEmitter.fire();
        }
    }

    private async request(triggerKind: InlineCompletionTriggerKind): Promise<void> {
        this.cancelAutoTrigger();
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        const providers = this.languageFeatures.inlineCompletionsProvider.ordered(editor);
        if (providers.length === 0) return;
        if (editor.readOnly) return;
        if (triggerKind === InlineCompletionTriggerKind.Automatic && !this.autoTriggerEnabled(editor.languageId))
            return;

        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) return;
        const caret = selections[0].active;
        const lineContent = editor.viewState.document.getLineContent(caret.line);

        const versionId = editor.viewState.document.versionId;
        const ticket = this.latest.start();
        const items = await provideInlineCompletions(
            providers,
            {
                uri: editor.uri.toString(),
                languageId: editor.languageId,
                versionId,
                line: caret.line,
                character: caret.character,
                triggerKind,
                timeoutMs: this.requestTimeoutMs(editor.languageId),
            },
            ticket.token,
        );
        ticket.done();
        if (this.group.getActiveEditor() !== editor) return;
        if (editor.viewState.document.versionId !== versionId) return;
        const current = editor.viewState.selections;
        if (current.length !== 1 || !isSelectionCollapsed(current[0])) return;
        if (current[0].active.line !== caret.line || current[0].active.character !== caret.character) return;
        // Escape and a silent editor change kill the request without changing text or cursor; this also
        // cuts off a provider that ignored the cancellation.
        if (ticket.isStale()) return;

        for (const item of items) {
            const session = this.sessionFromItem(editor, item, caret, lineContent);
            if (session !== null) {
                this.show(session);
                return;
            }
        }
        // Leave the pending auto request alone (a closing popup may have scheduled it): a full hide() would
        // eat someone else's scheduled request.
        this.clearSession();
    }

    private autoTriggerEnabled(languageId: string): boolean {
        return this.configuration.get("editor.inlineSuggest.enabled", { overrideIdentifier: languageId });
    }

    /** Ms. */
    private autoTriggerDelayMs(languageId: string | undefined): number {
        return this.configuration.get("editor.inlineSuggest.delay", { overrideIdentifier: languageId });
    }

    /** Ms. */
    private requestTimeoutMs(languageId: string): number {
        return this.configuration.get("editor.inlineSuggest.requestTimeout", { overrideIdentifier: languageId });
    }

    public acceptCurrent(): void {
        const session = this.session;
        // A suggestion hidden under the popup is not accepted: the user cannot see it.
        if (session === null || this.completionService.isOpen()) return;
        const editor = this.group.getActiveEditor();
        const caret = this.validCaretForSession(session, editor);
        /* v8 ignore start -- defensive: onCaretChanged kills the session before a
           mismatch can survive until the command (the dispatcher updates keys before resolving) */
        // Stryker disable ConditionalExpression,LogicalOperator,BlockStatement,CallExpression: unreachable defensive guard, see v8 ignore
        if (editor === null || caret === null) {
            this.hide();
            return;
        }
        // Stryker restore ConditionalExpression,LogicalOperator,BlockStatement,CallExpression
        /* v8 ignore stop */
        this.hide();
        // The edit below synchronously fires onCaretChanged — keep it from re-requesting.
        this.suppressAutoTriggerOnce = true;
        editor.applyExternalEdits(
            [
                createTextEdit(
                    createRange(session.line, session.startCharacter, session.line, caret.character),
                    session.insertText,
                ),
            ],
            "Accept Inline Suggestion",
            ([inserted]) => [createCursorSelection(inserted.range.end.line, inserted.range.end.character)],
        );
    }

    /**
     * Escape means "don't", not "hide": otherwise a request in flight or a pending one would pop up as
     * ghost text a second later.
     */
    public hide(): void {
        this.latest.cancel();
        this.cancelAutoTrigger();
        this.clearSession();
        this.onDidChangeStateEmitter.fire();
    }

    /** Leaves requests alone, unlike {@link hide}. */
    private clearSession(): void {
        if (this.session === null) return;
        this.session.editor.setGhostText(null);
        this.session = null;
        // Stryker disable next-line BooleanLiteral: paired with the session === null guard in hasIndentationLessThanTabSize — a mismatch is unreachable
        this.indentationLessThanTabSize = true;
    }

    /**
     * `null` means the item fails the show gate: the typed text is a prefix of `filterText ?? insertText`,
     * the tail is non-empty (vscode.d.ts contract), the range is single-line on the cursor line.
     */
    private sessionFromItem(
        editor: TextEditorPane,
        item: ICoreInlineCompletionItem,
        caret: IPosition,
        lineContent: string,
    ): IInlineSession | null {
        let startCharacter = caret.character;
        if (item.range !== undefined) {
            const range = item.range;
            if (range.start.line !== caret.line || range.end.line !== caret.line) return null;
            if (range.start.character > caret.character || range.end.character < caret.character) return null;
            startCharacter = range.start.character;
        }
        const typed = lineContent.slice(startCharacter, caret.character);
        if (!(item.filterText ?? item.insertText).startsWith(typed)) return null;
        if (!item.insertText.startsWith(typed)) return null;
        if (item.insertText.length === typed.length) return null;
        return { editor, line: caret.line, startCharacter, insertText: item.insertText };
    }

    /** `null` means the session is broken. The rest of the line RIGHT of the cursor does not count: it shifts right past the ghost. */
    private validCaretForSession(session: IInlineSession, editor: TextEditorPane | null): IPosition | null {
        if (editor !== session.editor) return null;
        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) return null;
        const caret = selections[0].active;
        if (caret.line !== session.line || caret.character < session.startCharacter) return null;
        const lineContent = editor.viewState.document.getLineContent(caret.line);
        const typed = lineContent.slice(session.startCharacter, caret.character);
        if (!session.insertText.startsWith(typed)) return null;
        if (session.insertText.length === typed.length) return null;
        return caret;
    }

    /** Under an open suggest popup the session is remembered but not drawn. */
    private show(session: IInlineSession): void {
        const caretCharacter = session.editor.viewState.selections[0].active.character;
        const remainder = session.insertText.slice(caretCharacter - session.startCharacter);
        const lines = remainder.split("\n");
        this.session = session;
        this.indentationLessThanTabSize = computeIndentationLessThanTabSize(
            session.editor.viewState.document.getLineContent(session.line),
            caretCharacter,
            lines[0],
            session.editor.viewState.tabSize,
        );
        session.editor.setGhostText(
            this.completionService.isOpen() ? null : { line: session.line, character: caretCharacter, lines },
        );
    }

    /** An edit without a session schedules an auto request — as upstream, on any text change. */
    private onCaretChanged(wasEdit: boolean): void {
        const suppressed = this.suppressAutoTriggerOnce;
        this.suppressAutoTriggerOnce = false;
        // The request snapshot is stale: the guards drop the answer anyway, so the provider may stop work now.
        this.latest.cancel();

        const editor = this.group.getActiveEditor();
        if (editor === null) {
            this.hide();
            return;
        }

        const session = this.session;
        if (session !== null) {
            const caret = this.validCaretForSession(session, editor);
            // Re-show only on an EDIT: a cursor move dismisses the suggestion (arrows remove the ghost text, as upstream).
            if (caret !== null && wasEdit) {
                this.show(session);
                return;
            }
            this.hide();
        }

        const selections = editor.viewState.selections;
        // The gate is repeated in trigger() before the RPC — a "widening" mutant only
        // schedules a request that cuts itself off; not observable.
        // Stryker disable next-line LogicalOperator,ConditionalExpression,EqualityOperator: see above
        const single = selections.length === 1 && isSelectionCollapsed(selections[0]);

        if (!suppressed && wasEdit && single) {
            this.scheduleAutoTrigger();
        } else {
            this.cancelAutoTrigger();
        }
    }

    private scheduleAutoTrigger(): void {
        this.autoTrigger.schedule(this.autoTriggerDelayMs(this.group.getActiveEditor()?.languageId));
    }

    private cancelAutoTrigger(): void {
        this.autoTrigger.cancel();
    }
}

/** An "indented" suggestion with the cursor in the indentation must not steal Tab from indenting (upstream `getIndentationInfo`). */
export function computeIndentationLessThanTabSize(
    lineContent: string,
    caretCharacter: number,
    ghostFirstLine: string,
    tabSize: number,
): boolean {
    const beforeCaret = lineContent.slice(0, caretCharacter);
    const cursorInIndentation = beforeCaret.trim().length === 0;
    if (!cursorInIndentation) return true;

    let width = 0;
    for (const char of ghostFirstLine) {
        // A tab always pads the width up to a tabSize multiple, i.e. to
        // >= tabSize (width here is always < tabSize — otherwise we would have exited earlier).
        if (char === "\t") return false;
        if (char !== " ") break;
        width += 1;
        if (width >= tabSize) return false;
    }
    return true;
}
