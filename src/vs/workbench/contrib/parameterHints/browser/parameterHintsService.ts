import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import { isSelectionCollapsed } from "../../../../editor/common/core/iSelection.ts";
import type {
    ICoreSignatureHelp,
    SignatureHelpTriggerKind as TriggerKind,
} from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { FocusTracker } from "../../../services/focus/browser/focusTracker.ts";
import { FocusTrackerDIToken } from "../../../services/focus/browser/focusTracker.ts";
import { splitMarkdownSections } from "../../hover/browser/hoverService.ts";

import type { ParameterHintsComponent } from "./parameterHintsComponent.ts";
import { ParameterHintsComponentDIToken } from "./parameterHintsComponent.ts";
import { provideSignatureHelp } from "./provideSignatureHelp.ts";
import { activeParameterSpan } from "./signatureLayout.ts";

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference — the string inside is only a debug label
export const ParameterHintsServiceDIToken = token<ParameterHintsService>("ParameterHintsService");

/**
 * While shown, it is re-requested on every edit and cursor move (the active parameter follows the
 * typing), and a `null` answer closes it: that is how the closing paren dismisses the popup.
 */
export class ParameterHintsService extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        ParameterHintsComponentDIToken,
        EditorServiceDIToken,
        FocusTrackerDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    /** Ms; for suggest, `editor.quickSuggestionsDelay` plays this role. */
    public triggerDelayMs = 120;

    private readonly latest = new LatestRequest();
    private readonly triggerScheduler = this.register(
        new RunOnceScheduler(() => {
            void this.trigger(this.scheduledTrigger.kind, this.scheduledTrigger.character);
        }, this.triggerDelayMs),
    );
    // No initializer: `scheduleTrigger` writes the field before every `schedule()`, the runner is never called earlier.
    private scheduledTrigger!: { kind: TriggerKind; character: string | undefined };
    /** Also echoed back to the server as `activeSignatureHelp`. */
    private currentHelp: ICoreSignatureHelp | null = null;
    private activeSignatureIndex = 0;

    public constructor(
        private readonly component: ParameterHintsComponent,
        private readonly group: IEditorService,
        focusTracker: FocusTracker,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {
        super();
        // Focus left the editor (Ctrl+Tab, Quick Open) — a popup without an anchor cannot stay.
        this.register(
            focusTracker.onDidChangeFocus((active) => {
                if (!(active instanceof EditorElement) && this.isOpen()) this.close();
            }),
        );
        this.register(
            bindActiveEditor(this.group, (editor, store) => {
                // In the app an editor change comes together with a focus change; this call is for a
                // programmatic change (session restore, split).
                // Stryker disable next-line CallExpression: see above
                this.close();
                if (editor === null) return;
                store.add(
                    editor.onDidType((text) => {
                        this.onDidType(editor, text);
                    }),
                );
                store.add(
                    editor.onDidChangeCursorPosition(() => {
                        this.onCaretChanged();
                    }),
                );
            }),
        );
    }

    public async trigger(
        triggerKind: TriggerKind = SignatureHelpTriggerKind.Invoke,
        character?: string,
    ): Promise<void> {
        this.cancelScheduledTrigger();
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        const providers = this.languageFeatures.signatureHelpProvider.ordered(editor);
        if (providers.length === 0) return;

        const caret = editor.viewState.selections[0].active;
        const ticket = this.latest.start();
        const isRetrigger = this.isOpen();
        const help = await provideSignatureHelp(
            providers,
            {
                uri: editor.uri.toString(),
                languageId: editor.languageId,
                versionId: editor.model.document.versionId,
                line: caret.line,
                character: caret.character,
                triggerKind,
                ...(character === undefined ? {} : { triggerCharacter: character }),
                isRetrigger,
                // Echo of the shown hint: the server uses it to keep the overload the user
                // picked with the arrows (tsserver finds it by label).
                // Stryker disable next-line ConditionalExpression: an open popup without a stored result is unreachable — `close()` clears both the session and the result together
                ...(isRetrigger && this.currentHelp !== null
                    ? { activeSignatureHelp: { ...this.currentHelp, activeSignature: this.activeSignatureIndex } }
                    : {}),
            },
            ticket.token,
        );
        if (ticket.isStale()) return;
        if (help === null) {
            this.close();
            return;
        }
        // The cursor may have moved during await — without an anchor there is nowhere to show.
        const anchor = editor.getCaretAnchor();
        if (anchor === null) {
            this.close();
            return;
        }

        this.currentHelp = help;
        this.activeSignatureIndex = clampIndex(help.activeSignature, help.signatures.length);
        this.renderHint();
        this.component.openAt(anchor);
    }

    public isOpen(): boolean {
        return this.component.isOpen();
    }

    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("parameterHintsVisible", this.isOpen());
        contextKeys.set("parameterHintsMultipleSignatures", (this.currentHelp?.signatures.length ?? 0) > 1);
    }

    /** Local, without a server request. */
    public nextSignature(): void {
        this.stepSignature(1);
    }

    public previousSignature(): void {
        this.stepSignature(-1);
    }

    public close(): void {
        this.cancelScheduledTrigger();
        this.component.close();
        this.component.setHint(null);
        this.currentHelp = null;
        this.activeSignatureIndex = 0;
        this.latest.cancel();
    }

    private stepSignature(delta: 1 | -1): void {
        const count = this.currentHelp?.signatures.length ?? 0;
        // Stryker disable next-line ConditionalExpression: without the exit a single signature just rebuilds the popup with the same content, and zero gives a NaN index that the next answer overwrites — behavior does not change
        if (count <= 1) return;
        this.activeSignatureIndex = (((this.activeSignatureIndex + delta) % count) + count) % count;
        this.renderHint();
    }

    private renderHint(): void {
        const help = this.currentHelp;
        /* v8 ignore start -- defensive: render is called only with a live hint */
        // Stryker disable next-line ConditionalExpression,EqualityOperator: the branch is unreachable — see v8 ignore above
        if (help === null) return;
        /* v8 ignore stop */
        const signature = help.signatures[this.activeSignatureIndex];
        const activeParameter = signature.activeParameter ?? help.activeParameter;
        const documentation = [signature.parameters[activeParameter]?.documentation, signature.documentation]
            .flatMap((doc) => (doc === undefined ? [] : splitMarkdownSections(doc)))
            .filter((doc) => doc !== "");
        this.component.setHint({
            label: signature.label,
            activeSpan: activeParameterSpan(signature, activeParameter),
            counter: help.signatures.length > 1 ? `${this.activeSignatureIndex + 1}/${help.signatures.length}` : null,
            documentation,
        });
    }

    /**
     * A retrigger character (`)`) goes to the server in the context; the answer is usually empty, so the
     * hint closes by itself. Arrives AFTER the cursor event and re-arms the `ContentChange` it scheduled
     * with its own kind.
     */
    private onDidType(editor: TextEditorPane, text: string): void {
        // Triggers are metadata of the providers matching this very document:
        // the TypeScript server's "(" does not wake the hint in markdown.
        const providers = this.languageFeatures.signatureHelpProvider.ordered(editor);
        const triggers = providers.some((provider) => provider.triggerCharacters.includes(text));
        const retriggers = this.isOpen() && providers.some((provider) => provider.retriggerCharacters.includes(text));
        if (triggers || retriggers) this.scheduleTrigger(SignatureHelpTriggerKind.TriggerCharacter, text);
    }

    /** Without a re-request the active parameter would stay stuck on the first one. */
    private onCaretChanged(): void {
        const editor = this.group.getActiveEditor();
        /* v8 ignore start -- defensive: events come from the bound editor */
        // Stryker disable next-line ConditionalExpression,EqualityOperator: the branch is unreachable — see v8 ignore above
        if (editor === null) return;
        /* v8 ignore stop */
        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) {
            // `close()` also cancels the pending request — otherwise "(" before a selection would open the popup over it.
            this.close();
            return;
        }
        if (this.isOpen()) this.scheduleTrigger(SignatureHelpTriggerKind.ContentChange, undefined);
    }

    private scheduleTrigger(kind: TriggerKind, character: string | undefined): void {
        this.scheduledTrigger = { kind, character };
        this.triggerScheduler.schedule(this.triggerDelayMs);
    }

    private cancelScheduledTrigger(): void {
        this.triggerScheduler.cancel();
    }
}

/** The server may send any index. */
function clampIndex(index: number, length: number): number {
    // Stryker disable next-line EqualityOperator: at index === 0 both bounds give zero — the same index as without the clamp
    if (index < 0 || index >= length) return 0;
    return index;
}
