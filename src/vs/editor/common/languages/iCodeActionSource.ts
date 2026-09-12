import type { IRange } from "../core/iRange.ts";

/** Чем спровоцирован запрос code actions (значения `vscode.CodeActionTriggerKind`). */
export const CodeActionTriggerKind = {
    /** Явный запрос пользователя (команда, меню). */
    Invoke: 1,
    /** Автоматический запрос (индикатор-лампочка на движение каретки). */
    Automatic: 2,
} as const;

export type CodeActionTriggerKind = (typeof CodeActionTriggerKind)[keyof typeof CodeActionTriggerKind];

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
    /** Полный текст документа (LF-канонический). */
    readonly text: string;
    /** Диапазон запроса (выделение/каретка; source-команды шлют весь документ). */
    readonly range: IRange;
    /**
     * LSP `CodeActionContext.only`: запрошенный вид действий
     * (`source.organizeImports`, `source.fixAll`, `quickfix`, …). Отсутствие —
     * без фильтра.
     */
    readonly only?: string;
    /**
     * LSP `CodeActionContext.triggerKind`: Invoke — явный запрос (команды),
     * Automatic — фоновый (лампочка). Отсутствие — Invoke; на Automatic серверы
     * вправе не считать дорогие рефакторинги.
     */
    readonly triggerKind?: CodeActionTriggerKind;
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
 * Code-action-источник: `provide` возвращает доступные действия, `apply`
 * резолвит и применяет выбранное. Инъектируется в ядро извне (host/харнесс) —
 * ядро не знает про extension-слой (зеркало {@link ./iFormattingSource.ts:FormattingSource}).
 *
 * `provide`: `null` — нет провайдера, матчащего документ (UI показывает «нет
 * действий»), пустой массив — провайдер есть, но действий не нашлось.
 * `apply`: `false` — действие протухло (кэш вытеснен), правки не применились
 * или команда упала.
 */
export interface CodeActionSource {
    provide(request: ICodeActionRequest): Promise<readonly ICoreCodeAction[] | null>;
    apply(id: string): Promise<boolean>;
}
