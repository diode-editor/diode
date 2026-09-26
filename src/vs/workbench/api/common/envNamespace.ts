import type * as vscode from "vscode";

import type { RpcEndpoint } from "./rpcEndpoint.ts";
import { parseWireClipboardText, parseWireOpenExternalResult } from "./wireTypes.ts";

/**
 * `vscode.env` на стороне subprocess'а.
 *
 * Поля-константы (`appName`, `language`, …) отдаются как есть — они не меняются
 * за жизнь процесса, и раунд-трип за ними был бы лишним. Буфер обмена и
 * `openExternal` — запросы к хосту: буфер один на приложение (тот же, что у
 * Copy/Paste редактора: системный через OSC 52 либо внутренний регистр), а
 * открыть ссылку может только процесс, у которого на руках окружение терминала.
 *
 * `openExternal` отвечает `true` и тогда, когда системного открывателя нет
 * (ssh, голый сервер): в этом случае хост показывает ссылку человеком, и с точки
 * зрения расширения операция состоялась — ссылка у пользователя. `false`
 * остаётся за настоящим отказом: показать её тоже не удалось.
 */
export interface IEnvApi {
    readonly appName: string;
    readonly appHost: string;
    readonly language: string;
    readonly uriScheme: string;
    readonly clipboard: vscode.Clipboard;
    openExternal(target: vscode.Uri): Thenable<boolean>;
}

/** Схема, которой адресуют сам редактор (`vscode:` у vscode). */
const URI_SCHEME = "diode";

/**
 * Адрес на провод — `toString(true)`, то есть БЕЗ percent-кодирования.
 * Кодирование здесь не безобидно: ссылку строило расширение для человека, и
 * `?token=demo`, превращённый в `?token%3Ddemo`, не узнает ни браузер, ни сервер
 * — типовой сценарий `openExternal` как раз такой (авторизация с токеном в query).
 *
 * Строку вместо `Uri` (расширение на JS) это тоже переживает: лишний аргумент
 * `String.prototype.toString` игнорирует и отдаёт саму строку.
 */
function wireTarget(target: vscode.Uri): string {
    return target.toString(true);
}

export function createEnvNamespace(rpc: RpcEndpoint): IEnvApi {
    return {
        appName: "Diode",
        // `desktop` — не «у нас есть окно», а «extension host рядом с UI»:
        // именно так это поле читают клиенты (альтернатива — `web`).
        appHost: "desktop",
        language: "en",
        uriScheme: URI_SCHEME,
        clipboard: {
            readText: async (): Promise<string> =>
                parseWireClipboardText(await rpc.request("env.clipboard.readText", {})).text,
            writeText: async (value: string): Promise<void> => {
                // Запросом, а не notify: `writeText` возвращает Thenable, и
                // расширение вправе рассчитывать, что после await текст уже в
                // буфере (типовой сценарий — записал и сказал об этом человеку).
                await rpc.request("env.clipboard.writeText", { text: value });
            },
        },
        openExternal: async (target: vscode.Uri): Promise<boolean> =>
            parseWireOpenExternalResult(await rpc.request("env.openExternal", { target: wireTarget(target) })).opened,
    };
}
