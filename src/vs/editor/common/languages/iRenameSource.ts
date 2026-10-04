/**
 * Запрос «переименовать символ в этой позиции», отправляемый rename-провайдеру.
 * Несёт полный снапшот текста + позицию каретки (у хоста нет реестра
 * документов — как definition/hover, снапшот передаётся целиком).
 */
export interface IRenameRequest {
    /** Ресурс активного документа как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Полный текст документа (LF-канонический). */
    readonly text: string;
    /** Позиция каретки, 0-based. */
    readonly line: number;
    readonly character: number;
}

/**
 * Ответ `prepareRename` одного провайдера: либо ТЕКУЩЕЕ имя символа (оно же
 * placeholder поля ввода), либо отказ «здесь переименовать нельзя» с причиной
 * (upstream `RenameLocation & Rejection`). `null` вместо этого — провайдеру
 * сказать нечего, спрашиваем следующего.
 */
export type ICoreRenameLocation =
    | { readonly kind: "name"; readonly name: string }
    | { readonly kind: "reject"; readonly reason: string };

/**
 * Исход применения переименования. `applied: false` без `error` — провайдер не
 * дал правок (переименовывать нечего, спрашиваем следующего); с `error` —
 * провайдер отклонил запрос (невалидное имя) либо правки не легли.
 */
export interface ICoreRenameResult {
    readonly applied: boolean;
    /** Сообщение об отказе для UI; у успеха отсутствует. */
    readonly error?: string;
}

/**
 * Один rename-провайдер в реестре `ILanguageFeaturesService.renameProvider`
 * (upstream `languages.RenameProvider`): `prepareRename` сообщает текущее имя
 * символа, `provideRenameEdits` применяет правки нового имени. Провайдеров
 * расширений регистрирует туда `LanguageFeaturesAdapter`.
 *
 * Правки остаются в субпроцессе и уезжают существующим RPC
 * `workspace.applyEdit` — ядру не нужен `WorkspaceEdit`, как и у code actions
 * ({@link ./iCodeActionSource.ts} с его `applyCodeAction`). Это же даёт
 * переименованию bulk edit целиком: правки по закрытым файлам и ОДИН шаг
 * отмены на весь rename.
 */
export interface RenameProvider {
    prepareRename(request: IRenameRequest): Promise<ICoreRenameLocation | null>;
    provideRenameEdits(request: IRenameRequest, newName: string): Promise<ICoreRenameResult>;
}
