import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

export interface ICompletionRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Текст провайдер берёт из своей синхронизированной копии этой версии. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
    /** Серверы отвечают по-разному: после `.` с `Invoke` tsserver может не дать членов вовсе. */
    readonly triggerKind?: CompletionTriggerKind;
    readonly triggerCharacter?: string;
}

/** Значения `vscode.CompletionTriggerKind`. */
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

/** `insertText` уже нормализован: fallback на `label` делает хост при сериализации. */
export interface ICoreCompletionItem {
    readonly label: string;
    readonly insertText: string;
    /** Нет id — резолвить нечего (word-based пункт, провайдер без `resolveCompletionItem`). */
    readonly id?: string;
    /** `labelDetails.detail`. */
    readonly labelDetail?: string;
    /** `labelDetails.description`. */
    readonly labelDescription?: string;
    /** Числовой `CompletionItemKind` VS Code (0…26). */
    readonly kind?: number;
    readonly detail?: string;
    readonly documentation?: string;
    readonly command?: ICoreCompletionCommand;
    /** Не задан — ядро берёт префикс. */
    readonly range?: IRange;
    readonly sortText?: string;
    readonly filterText?: string;
    /** Пришли сразу в списке (gopls) — принятие применяет их без resolve, как `suggestController` эталона. */
    readonly additionalEdits?: readonly ITextEdit[];
}

/**
 * `isIncomplete` — сервер отфильтровал список под префикс: добор символа обязан
 * перезапросить источник, а не сужать локально.
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

/** upstream `languages.CompletionItemProvider` + метаданные регистрации. */
export interface CompletionItemProvider {
    readonly triggerCharacters: readonly string[];
    provideCompletionItems(request: ICompletionRequest, token: ICancellationToken): Promise<ICoreCompletionResult>;
    /** `null` — провайдер не ответил или резолва нет; попап остаётся с тем, что есть. */
    resolveCompletionItem?(id: string): Promise<ICoreResolvedCompletion | null>;
}
