import type { IRange } from "../core/iRange.ts";

/**
 * Запрос «какие code actions доступны в этом диапазоне», отправляемый
 * code-action-источнику. Несёт полный снапшот текста (у хоста нет реестра
 * документов — как definition/hover, снапшот целиком). Контекстные диагностики
 * НЕ передаются: субпроцесс собирает их сам из своих DiagnosticCollection —
 * так серверу возвращаются ТЕ ЖЕ объекты диагностик (с приватным `data`
 * протокол-конвертера клиента), а не наша lossy-копия.
 */
export interface ICodeActionRequest {
    /** Ресурс активного документа как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Версия документа на момент запроса: текст провайдер берёт из своей синхронизированной копии. */
    readonly versionId: number;
    /** Диапазон запроса (выделение/каретка; source-команды шлют весь документ). */
    readonly range: IRange;
    /**
     * LSP `CodeActionContext.only`: запрошенный вид действий
     * (`source.organizeImports`, `source.fixAll`, `quickfix`, …). Отсутствие —
     * без фильтра.
     */
    readonly only?: string;
}

/**
 * Один доступный code action в ядре — только метаданные для показа/выбора.
 * Сами правки остаются в субпроцессе: применение идёт по {@link CodeActionSource.apply}
 * с `id` (правки едут существующим RPC `workspace.applyEdit`, команды
 * исполняются там же — ядру не нужен ни WorkspaceEdit, ни vscode.Command).
 */
export interface ICoreCodeAction {
    /** Ключ действия в кэше субпроцесса (`"<cacheId>.<index>"`). */
    readonly id: string;
    readonly title: string;
    /** Иерархический вид (`quickfix`, `source.fixAll.ruff`, …); у голых команд отсутствует. */
    readonly kind?: string;
    /** Провайдер пометил действие предпочтительным (auto-fix выбирает его). */
    readonly isPreferred?: boolean;
}

/**
 * Провайдер code actions в реестре `ILanguageFeaturesService.codeActionProvider`
 * (upstream `languages.CodeActionProvider` + метаданные регистрации).
 * `provideCodeActions` возвращает доступные действия (пустой список — их нет),
 * `applyCodeAction` резолвит и применяет своё действие: `false` — действие
 * протухло (кэш вытеснен), правки не применились или команда упала.
 */
export interface CodeActionProvider {
    /**
     * Виды, которые провайдер вообще отдаёт (`providedCodeActionKinds`); пустой
     * список — любые. Провайдера, чьи виды не пересекаются с запрошенным
     * `only`, не спрашивают.
     */
    readonly providedCodeActionKinds: readonly string[];
    provideCodeActions(request: ICodeActionRequest): Promise<readonly ICoreCodeAction[]>;
    applyCodeAction(id: string): Promise<boolean>;
}
