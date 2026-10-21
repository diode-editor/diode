import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

export interface IInlineCompletionRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
    /** Per the vscode contract, a provider may return several items on Invoke and one on Automatic. */
    readonly triggerKind: InlineCompletionTriggerKind;
    /**
     * Ms. Sent with EVERY request rather than fixed when the source is created; otherwise
     * a settings change would only apply after a restart.
     */
    readonly timeoutMs?: number;
}

/** Values of `vscode.InlineCompletionTriggerKind`. */
export const InlineCompletionTriggerKind = {
    Invoke: 0,
    Automatic: 1,
} as const;

export type InlineCompletionTriggerKind =
    (typeof InlineCompletionTriggerKind)[keyof typeof InlineCompletionTriggerKind];

/** The extension host serializes a `SnippetString` into `insertText` with placeholders stripped. */
export interface ICoreInlineCompletionItem {
    readonly insertText: string;
    /** Shown only if the replaced text is a prefix of `filterText ?? insertText` (vscode.d.ts contract). */
    readonly filterText?: string;
    /** Within a single line; without it the text is inserted at the request cursor position. */
    readonly range?: IRange;
}

/**
 * upstream `languages.InlineCompletionsProvider`. Cancelling `token` reaches the
 * extension provider, since ghost text may be backed by a paid LLM call.
 */
export interface InlineCompletionsProvider {
    provideInlineCompletions(
        request: IInlineCompletionRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreInlineCompletionItem[]>;
}
