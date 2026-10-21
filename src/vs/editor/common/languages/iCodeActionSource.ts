import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

/**
 * Контекстные диагностики НЕ передаются: субпроцесс собирает их сам из своих
 * DiagnosticCollection — так серверу возвращаются ТЕ ЖЕ объекты (с приватным
 * `data` протокол-конвертера клиента), а не наша lossy-копия.
 */
export interface ICodeActionRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Текст провайдер берёт из своей синхронизированной копии этой версии. */
    readonly versionId: number;
    readonly range: IRange;
    /** LSP `CodeActionContext.only`; отсутствие — без фильтра. */
    readonly only?: string;
}

/**
 * Только метаданные: правки остаются в субпроцессе и применяются по `id` через
 * {@link CodeActionProvider.applyCodeAction}.
 */
export interface ICoreCodeAction {
    /** `"<cacheId>.<index>"` в кэше субпроцесса. */
    readonly id: string;
    readonly title: string;
    /** У голых команд отсутствует. */
    readonly kind?: string;
    readonly isPreferred?: boolean;
    /** Меню показывает такое действие неактивным с причиной, авто-применение пропускает — как эталон. */
    readonly disabled?: string;
}

/** upstream `languages.CodeActionProvider` + метаданные регистрации. */
export interface CodeActionProvider {
    /** Пустой список — любые. */
    readonly providedCodeActionKinds: readonly string[];
    provideCodeActions(request: ICodeActionRequest, token: ICancellationToken): Promise<readonly ICoreCodeAction[]>;
    /** `false` — действие протухло (кэш вытеснен), правки не применились или команда упала. */
    applyCodeAction(id: string, options?: IApplyCodeActionOptions): Promise<boolean>;
}

/** `ApplyCodeActionReason` эталона в нужном нам объёме. */
export interface IApplyCodeActionOptions {
    /** Правки не подпадают под `files.refactoring.autoSave` — как у эталона для `OnSave`. */
    readonly onSave?: boolean;
}
