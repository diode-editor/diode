import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

/**
 * Context diagnostics are NOT sent: the extension host collects them from its own
 * DiagnosticCollection, so the server gets back THE SAME objects (with the client
 * protocol converter's private `data`) rather than our lossy copy.
 */
export interface ICodeActionRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    readonly range: IRange;
    /** LSP `CodeActionContext.only`; absent means no filter. */
    readonly only?: string;
}

/**
 * Metadata only: edits stay in the extension host and are applied by `id` via
 * {@link CodeActionProvider.applyCodeAction}.
 */
export interface ICoreCodeAction {
    /** `"<cacheId>.<index>"` in the extension host cache. */
    readonly id: string;
    readonly title: string;
    /** Absent for bare commands. */
    readonly kind?: string;
    readonly isPreferred?: boolean;
    /** The menu shows such an action disabled with the reason, auto-apply skips it, as upstream. */
    readonly disabled?: string;
}

/** upstream `languages.CodeActionProvider` + registration metadata. */
export interface CodeActionProvider {
    /** An empty list means any kind. */
    readonly providedCodeActionKinds: readonly string[];
    provideCodeActions(request: ICodeActionRequest, token: ICancellationToken): Promise<readonly ICoreCodeAction[]>;
    /** `false`: the action is stale (cache evicted), the edits did not apply, or the command failed. */
    applyCodeAction(id: string, options?: IApplyCodeActionOptions): Promise<boolean>;
}

/** The subset of upstream `ApplyCodeActionReason` that we need. */
export interface IApplyCodeActionOptions {
    /** Edits are exempt from `files.refactoring.autoSave`, as upstream does for `OnSave`. */
    readonly onSave?: boolean;
}
