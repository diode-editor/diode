import type * as vscode from "vscode";

import type { RpcEndpoint } from "./rpcEndpoint.ts";
import { type IWireMessageItem, parseWireShowMessageResult, type WireMessageSeverity } from "./wireTypes.ts";

/**
 * `window.showInformationMessage` / `showWarningMessage` / `showErrorMessage` на
 * стороне subprocess'а.
 *
 * Поверхность живёт у хоста (стек тостов над статус-баром, у модального
 * сообщения — центральный диалог), поэтому каждый показ — это ОДИН запрос по
 * проводу и ожидание ответа: перегрузка с кнопками обязана вернуть расширению
 * то, что человек нажал. Сообщению без кнопок выбирать нечего, и хост отвечает
 * на него сразу — обещание расширения не висит на времени жизни тоста.
 *
 * Ответ приходит ИНДЕКСОМ в присланном массиве: `showInformationMessage<T
 * extends MessageItem>` возвращает `T`, то есть расширение обязано получить
 * обратно СВОЙ объект, а пересобранный по проводу предмет им бы не был.
 *
 * Состояния у api нет — показ корреллирует сам запрос, а адрес для «погасить
 * при смерти субпроцесса» минтит хост. Поэтому экземпляр можно завести где
 * удобно: и `window`, и `workspace` (предупреждение неподдержанного
 * `getConfiguration().update`) делают это сами.
 */
export interface IMessageApi {
    showInformationMessage(message: string, ...rest: unknown[]): Thenable<unknown>;
    showWarningMessage(message: string, ...rest: unknown[]): Thenable<unknown>;
    showErrorMessage(message: string, ...rest: unknown[]): Thenable<unknown>;
}

/** Разобранные аргументы перегрузок `show*Message`. */
export interface IParsedMessageArgs {
    /** `MessageOptions.modal`. */
    readonly modal: boolean;
    /** `MessageOptions.detail`; пустая строка — то же, что отсутствие. */
    readonly detail?: string;
    /** Кнопки как их прислало расширение — ответ адресуется индексом здесь. */
    readonly items: readonly (string | vscode.MessageItem)[];
}

/**
 * Первый аргумент после текста — это кнопка, а не опции? Признак тот же, что в
 * эталоне: у `MessageItem` есть `title`, у `MessageOptions` его нет.
 */
function isMessageItem(value: unknown): value is vscode.MessageItem {
    return typeof value === "object" && value !== null && "title" in value;
}

/** Текст, если в нём что-то есть; пустая строка и отсутствие — одно и то же. */
function nonEmpty(text: unknown): string | undefined {
    return typeof text === "string" && text !== "" ? text : undefined;
}

/**
 * Раскладывает `(message, optionsOrFirstItem, ...rest)` четырёх перегрузок:
 * второй аргумент — либо первая кнопка (строка или `MessageItem`), либо
 * `MessageOptions`, и тогда кнопки начинаются с третьего.
 */
export function parseMessageArgs(first: unknown, rest: readonly unknown[]): IParsedMessageArgs {
    if (typeof first === "string" || isMessageItem(first)) {
        return { modal: false, items: [first, ...(rest as readonly (string | vscode.MessageItem)[])] };
    }
    // Не кнопка — значит опции (или ничего, и тогда кнопок нет вовсе). Что это
    // ИМЕННО объект, не проверяем: поля читаются через `?.`, и на мусоре (числе,
    // `null`, отсутствии) результат тот же — «опций нет».
    const options = first as vscode.MessageOptions | undefined;
    return {
        modal: options?.modal === true,
        detail: nonEmpty(options?.detail),
        items: rest as readonly (string | vscode.MessageItem)[],
    };
}

/** Кнопка расширения → строка на проводе. Строковая кнопка сама себе заголовок. */
export function toWireMessageItem(item: string | vscode.MessageItem): IWireMessageItem {
    if (typeof item === "string") return { title: item, isCloseAffordance: false };
    return { title: item.title, isCloseAffordance: item.isCloseAffordance === true };
}

export function createMessageApi(rpc: RpcEndpoint): IMessageApi {
    const show = async (
        severity: WireMessageSeverity,
        // `unknown`, а не `string`: типы есть только у наших вызовов, а расширение
        // на JS вправе прислать сюда что угодно.
        message: unknown,
        first: unknown,
        rest: readonly unknown[],
    ): Promise<unknown> => {
        const parsed = parseMessageArgs(first, rest);
        const result = parseWireShowMessageResult(
            await rpc.request("window.showMessage", {
                severity,
                // `String(...)` без проверки типа: расширение вправе прислать
                // что угодно (типов у него нет, если он на JS), а у строки
                // строковое представление — она сама.
                message: String(message),
                modal: parsed.modal,
                detail: parsed.detail,
                items: parsed.items.map(toWireMessageItem),
            }),
        );
        if (result.index === null) return undefined;
        // `.at` сам отдаёт undefined на индексе за пределами массива: такой ответ
        // не про этот показ, и отдавать расширению дырку в его кнопках нельзя.
        return parsed.items.at(result.index);
    };

    return {
        showInformationMessage: (message, first?, ...rest) => show("info", message, first, rest),
        showWarningMessage: (message, first?, ...rest) => show("warn", message, first, rest),
        showErrorMessage: (message, first?, ...rest) => show("error", message, first, rest),
    };
}
