export interface IRenameRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Текст провайдер берёт из своей синхронизированной копии этой версии. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
}

/** upstream `RenameLocation & Rejection`; `null` вместо него — спрашиваем следующего провайдера. */
export type ICoreRenameLocation =
    | { readonly kind: "name"; readonly name: string }
    | { readonly kind: "reject"; readonly reason: string };

/**
 * `applied: false` без `error` — правок нет, спрашиваем следующего; с `error` —
 * провайдер отклонил запрос либо правки не легли.
 */
export interface ICoreRenameResult {
    readonly applied: boolean;
    readonly error?: string;
}

/**
 * upstream `languages.RenameProvider`. Правки уезжают из субпроцесса RPC
 * `workspace.applyEdit`, как у code actions, — это даёт bulk edit целиком:
 * правки по закрытым файлам и ОДИН шаг отмены на весь rename.
 */
export interface RenameProvider {
    prepareRename(request: IRenameRequest): Promise<ICoreRenameLocation | null>;
    provideRenameEdits(request: IRenameRequest, newName: string): Promise<ICoreRenameResult>;
}
