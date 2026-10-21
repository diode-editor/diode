export interface IRenameRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
}

/** upstream `RenameLocation & Rejection`; `null` instead means ask the next provider. */
export type ICoreRenameLocation =
    | { readonly kind: "name"; readonly name: string }
    | { readonly kind: "reject"; readonly reason: string };

/**
 * `applied: false` without `error`: no edits, ask the next provider; with `error`: the
 * provider rejected the request or the edits failed to apply.
 */
export interface ICoreRenameResult {
    readonly applied: boolean;
    readonly error?: string;
}

/**
 * upstream `languages.RenameProvider`. Edits leave the extension host via the
 * `workspace.applyEdit` RPC, as with code actions; that yields a full bulk edit:
 * edits to closed files and ONE undo step for the whole rename.
 */
export interface RenameProvider {
    prepareRename(request: IRenameRequest): Promise<ICoreRenameLocation | null>;
    provideRenameEdits(request: IRenameRequest, newName: string): Promise<ICoreRenameResult>;
}
