import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

export interface ICompletionRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
    /** Servers answer differently: after `.` with `Invoke`, tsserver may return no members at all. */
    readonly triggerKind?: CompletionTriggerKind;
    readonly triggerCharacter?: string;
}

/** Values of `vscode.CompletionTriggerKind`. */
export const CompletionTriggerKind = {
    Invoke: 0,
    TriggerCharacter: 1,
    TriggerForIncompleteCompletions: 2,
} as const;

export type CompletionTriggerKind = (typeof CompletionTriggerKind)[keyof typeof CompletionTriggerKind];

export interface ICoreCompletionCommand {
    readonly command: string;
    readonly arguments?: readonly unknown[];
}

/** `insertText` is already normalized: the host falls back to `label` when serializing. */
export interface ICoreCompletionItem {
    readonly label: string;
    readonly insertText: string;
    /** No id: nothing to resolve (word-based item, provider without `resolveCompletionItem`). */
    readonly id?: string;
    /** `labelDetails.detail`. */
    readonly labelDetail?: string;
    /** `labelDetails.description`. */
    readonly labelDescription?: string;
    /** Numeric VS Code `CompletionItemKind` (0…26). */
    readonly kind?: number;
    readonly detail?: string;
    readonly documentation?: string;
    readonly command?: ICoreCompletionCommand;
    /** Absent: the core uses the prefix. */
    readonly range?: IRange;
    readonly sortText?: string;
    readonly filterText?: string;
    /** Sent right in the list (gopls): accepting applies them without resolve, like upstream `suggestController`. */
    readonly additionalEdits?: readonly ITextEdit[];
}

/**
 * `isIncomplete`: the server filtered the list for the prefix, so typing another character
 * must re-query the source instead of narrowing locally.
 */
export interface ICoreCompletionResult {
    readonly items: readonly ICoreCompletionItem[];
    readonly isIncomplete: boolean;
}

export interface ICoreResolvedCompletion {
    readonly detail?: string;
    readonly documentation?: string;
    readonly additionalEdits?: readonly ITextEdit[];
}

/** upstream `languages.CompletionItemProvider` + registration metadata. */
export interface CompletionItemProvider {
    readonly triggerCharacters: readonly string[];
    provideCompletionItems(request: ICompletionRequest, token: ICancellationToken): Promise<ICoreCompletionResult>;
    /** `null`: the provider did not answer or has no resolve; the popup keeps what it has. */
    resolveCompletionItem?(id: string): Promise<ICoreResolvedCompletion | null>;
}
