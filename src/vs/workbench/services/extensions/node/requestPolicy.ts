import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../api/common/extHostProtocol.ts";
import { TimeoutError } from "../../../api/common/rpcEndpoint.ts";

import type { RequestFn } from "./hostRequests.ts";

/**
 * Сроки ответа субпроцесса на pull-запросы хоста, мс, по методу провода.
 * Истёкший срок — отмена запроса (провайдер видит токен, language server —
 * `$/cancelRequest`) и пустой результат. Единственное исключение — inline
 * completions: срок берётся из самого запроса (`editor.inlineSuggest.requestTimeout`),
 * а отсюда — только при его отсутствии.
 *
 * `languages.provideCompletionItems` в таблице нет намеренно: у автодополнения
 * срока ответа нет, как и в upstream (`provideSuggestionItems` ждёт провайдеров
 * столько, сколько они думают, а ненужный запрос отменяет токеном). Срок здесь
 * не «пустой ответ», а подмена: по пустому ответу ядро открывает попап словами
 * из буфера, и language server, не уложившийся в срок на холодном старте или
 * под нагрузкой, оставался без своих пунктов до закрытия попапа. Ненужный
 * запрос гасит `CompletionService` (перезапрос, уход каретки, закрытие).
 */
export const DEFAULT_REQUEST_TIMEOUTS = {
    "workspace.willSaveTextDocument": 1500,
    "languages.resolveCompletionItem": 1500,
    "languages.provideInlineCompletions": 5000,
    "languages.provideFoldingRanges": 1500,
    "languages.provideDefinition": 5000,
    "languages.provideHover": 5000,
    "languages.provideReferences": 5000,
    "languages.provideSignatureHelp": 5000,
    "languages.provideFormattingEdits": 5000,
    "languages.provideCodeActions": 5000,
    "languages.applyCodeAction": 10000,
    "languages.prepareRename": 5000,
    "languages.provideRenameEdits": 10000,
} as const satisfies Readonly<Record<string, number>>;

/** Метод провода со сроком ответа (ключ {@link DEFAULT_REQUEST_TIMEOUTS}). */
export type TimedRequestMethod = keyof typeof DEFAULT_REQUEST_TIMEOUTS;

/** Сроки ответа по методу — см. {@link DEFAULT_REQUEST_TIMEOUTS}. */
export type RequestTimeouts = Readonly<Record<TimedRequestMethod, number>>;

/**
 * Отправка запросов субпроцессу с записью сбоя в лог: истёкший срок — debug
 * (штатный исход медленного провайдера), отказ — warn с методом и ошибкой
 * (её стек расширения доезжает целиком). Сам исход вызывающий получает
 * отклонением, как от `rpc.request`.
 */
export function loggingRequest(rpc: HostRpc, logger: ILogger | undefined): RequestFn {
    return (method, params, options) =>
        rpc.request(method, params, options).catch((error: unknown) => {
            if (error instanceof TimeoutError) {
                logger?.debug(error.message);
            } else {
                logger?.warn(`request "${method}" failed`, error);
            }
            throw error;
        });
}
