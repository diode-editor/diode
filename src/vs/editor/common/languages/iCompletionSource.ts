import type { IRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

/**
 * Запрос автодополнения, отправляемый completion-источнику. Несёт полный
 * снапшот текста + позицию курсора (у хоста нет реестра документов — как и в
 * will-save, снапшот передаётся целиком).
 */
export interface ICompletionRequest {
    /** Ресурс активного документа как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Полный текст документа (LF-канонический). */
    readonly text: string;
    /** Позиция курсора, 0-based. */
    readonly line: number;
    readonly character: number;
    /**
     * Чем спровоцирован запрос (`vscode.CompletionTriggerKind`): 0 — Invoke
     * (Ctrl+Space, набор слова), 1 — TriggerCharacter, 2 — добор по неполному
     * списку. Серверы отвечают по-разному: после `.` с `Invoke` tsserver может
     * не дать членов вовсе.
     */
    readonly triggerKind?: CompletionTriggerKind;
    /** Символ-триггер (`.`), когда `triggerKind === TriggerCharacter`. */
    readonly triggerCharacter?: string;
}

/** Чем спровоцирован запрос автодополнения (значения `vscode.CompletionTriggerKind`). */
export const CompletionTriggerKind = {
    Invoke: 0,
    TriggerCharacter: 1,
    TriggerForIncompleteCompletions: 2,
} as const;

export type CompletionTriggerKind = (typeof CompletionTriggerKind)[keyof typeof CompletionTriggerKind];

/**
 * Команда, привязанная к элементу автодополнения (`CompletionItem.command`).
 * После вставки исполняется через commands bridge (editorconfig использует это
 * для повторного `editor.action.triggerSuggest`).
 */
export interface ICoreCompletionCommand {
    readonly command: string;
    readonly arguments?: readonly unknown[];
}

/**
 * Элемент автодополнения в ядре (десериализованная форма расширенческого
 * `vscode.CompletionItem`). `insertText` уже нормализован (fallback на `label`
 * делает хост при сериализации).
 */
export interface ICoreCompletionItem {
    readonly label: string;
    readonly insertText: string;
    /**
     * Непрозрачный ключ пункта у источника — по нему запрашивается
     * {@link CompletionResolver}. Нет id — резолвить нечего (word-based пункт,
     * провайдер без `resolveCompletionItem`).
     */
    readonly id?: string;
    /** Сигнатура рядом с лейблом (`labelDetails.detail`: `(a: string): void`). */
    readonly labelDetail?: string;
    /** Источник пункта (`labelDetails.description`: модуль авто-импорта). */
    readonly labelDescription?: string;
    /** Числовой `CompletionItemKind` (значения enum VS Code 0…26). */
    readonly kind?: number;
    readonly detail?: string;
    readonly documentation?: string;
    readonly command?: ICoreCompletionCommand;
    /** Диапазон замены (если провайдер задал его явно); иначе ядро берёт префикс. */
    readonly range?: IRange;
    readonly sortText?: string;
    readonly filterText?: string;
}

/**
 * Ответ completion-источника. `isIncomplete` — список неполон (сервер отфильтровал
 * его под текущий префикс): добор символа обязан перезапросить источник, а не
 * сужать локально.
 */
export interface ICoreCompletionResult {
    readonly items: readonly ICoreCompletionItem[];
    readonly isIncomplete: boolean;
}

/**
 * Догруженные поля пункта (`completionItem/resolve` в терминах LSP): описание
 * для панели и правки-спутники авто-импорта.
 */
export interface ICoreResolvedCompletion {
    readonly detail?: string;
    readonly documentation?: string;
    /** Правки, которые обязаны примениться вместе со вставкой (`import` сверху файла). */
    readonly additionalEdits?: readonly ITextEdit[];
}

/**
 * Completion-источник: по запросу возвращает элементы автодополнения от
 * провайдеров расширений. Инъектируется в ядро извне (host/харнесс) — ядро не
 * знает про extension-слой (зеркало {@link ./ISaveParticipant.ts:SaveParticipant}).
 * Пустой результат = автодополнений нет.
 */
export type CompletionSource = (request: ICompletionRequest) => Promise<ICoreCompletionResult>;

/**
 * Ленивая догрузка одного пункта по его {@link ICoreCompletionItem.id}. `null` —
 * источник не ответил или резолв не поддержан; попап остаётся с тем, что есть.
 */
export type CompletionResolver = (id: string) => Promise<ICoreResolvedCompletion | null>;
