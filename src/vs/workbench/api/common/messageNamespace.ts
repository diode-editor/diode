import type * as vscode from "vscode";

import type { RpcEndpoint } from "./rpcEndpoint.ts";
import { parseWireShowMessageResult, type WireMessageSeverity } from "./wireTypes.ts";

/**
 * `window.showInformationMessage` / `showWarningMessage` / `showErrorMessage` на
 * стороне subprocess'а.
 *
 * Сообщение с пунктами — это ВОПРОС: обещание расширения обязано резолвиться
 * тем, что человек нажал. Поэтому здесь запрос с ответом, а не fire-and-forget
 * notify, и ответ приходит ИНДЕКСОМ в присланном массиве подписей — расширение
 * должно получить обратно свой собственный предмет (`showInformationMessage<T
 * extends MessageItem>` возвращает `T`), а пересобранный по проводу объект им бы
 * не был. Точно так же устроены `showQuickPick` (quickInputNamespace.ts) и
 * прогресс: UI живёт у хоста, шим только спрашивает.
 *
 * Токена отмены у этого API нет — снимать показ извне расширение не умеет,
 * поэтому handle'а (в отличие от quick input) здесь тоже нет: запрос с ответом
 * спаривает сам RPC.
 */
export interface IMessageApi {
    showInformationMessage(message: string, ...rest: MessageArg[]): Thenable<MessageChoice>;
    showWarningMessage(message: string, ...rest: MessageArg[]): Thenable<MessageChoice>;
    showErrorMessage(message: string, ...rest: MessageArg[]): Thenable<MessageChoice>;
}

/** Аргумент после текста: пункт-кнопка (строка или `MessageItem`) либо `MessageOptions`. */
export type MessageArg = string | vscode.MessageItem | vscode.MessageOptions;

/** Что видит расширение: нажатый пункт (его собственный объект) либо `undefined`. */
export type MessageChoice = string | vscode.MessageItem | undefined;

/**
 * Отделяет `MessageOptions` от пунктов. Опции — объект БЕЗ `title` (у
 * `MessageItem` поле обязательное), и стоять они могут только первыми: так
 * объявлены перегрузки в `vscode.d.ts`, и так же их различает сам vscode.
 *
 * `modal`/`detail` мы не поддерживаем (docs/public/API-COVERAGE.md), но
 * ОТЛИЧИТЬ опции от пункта обязаны: иначе объект опций уехал бы на провод
 * кнопкой без подписи, и расширение получило бы его в ответе.
 */
export function messageItemsOf(rest: readonly MessageArg[]): readonly (string | vscode.MessageItem)[] {
    // `unknown`, а не тип объединения: аргументы приходят из кода расширения,
    // где `null` на месте опций типами не запрещён никем.
    const first: unknown = rest.at(0);
    if (typeof first === "object" && first !== null && !("title" in first)) {
        return rest.slice(1) as (string | vscode.MessageItem)[];
    }
    return rest as (string | vscode.MessageItem)[];
}

/**
 * Подпись пункта для провода. Нестроковый `title` (расширение на JS) не чиним
 * здесь: нормализацией занят разбор на проводе — одна точка вместо двух.
 */
function titleOf(item: string | vscode.MessageItem): string {
    return typeof item === "string" ? item : item.title;
}

async function showMessage(
    rpc: RpcEndpoint,
    severity: WireMessageSeverity,
    message: string,
    rest: readonly MessageArg[],
): Promise<MessageChoice> {
    const items = messageItemsOf(rest);
    const result = parseWireShowMessageResult(
        await rpc.request("window.showMessage", { severity, message, items: items.map(titleOf) }),
    );
    if (result.index === null) return undefined;
    // `.at` — не только вкус: индекс за пределами списка значит «ответ не про
    // этот показ», и расширение должно получить `undefined`, а не дыру.
    return items.at(result.index);
}

export function createMessageApi(rpc: RpcEndpoint): IMessageApi {
    return {
        showInformationMessage: (message, ...rest) => showMessage(rpc, "info", message, rest),
        showWarningMessage: (message, ...rest) => showMessage(rpc, "warn", message, rest),
        showErrorMessage: (message, ...rest) => showMessage(rpc, "error", message, rest),
    };
}

/**
 * Сообщение от самого шима (не от кода расширения): предупреждения про
 * неподдержанное API. Путь до экрана тот же запрос — показывать своё иначе, чем
 * расширенческое, было бы вторым UI, — но исход никого не интересует, а отказ
 * канала надо проглотить: необработанный rejection в субпроцессе роняет его
 * целиком, и сообщение о неподдержанном API убивало бы расширение.
 */
export function notifyMessage(rpc: RpcEndpoint, severity: WireMessageSeverity, message: string): void {
    void rpc.request("window.showMessage", { severity, message, items: [] }).catch(() => undefined);
}
