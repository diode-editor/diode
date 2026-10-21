import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { type IWireMessageItem, parseWireShowMessageResult, type WireMessageSeverity } from "./wireTypes.ts";

/**
 * Ответ приходит ИНДЕКСОМ: `show*Message<T extends MessageItem>` возвращает `T`, и
 * расширение обязано получить обратно СВОЙ объект. Сообщению без кнопок хост отвечает
 * сразу — промис расширения не висит на времени жизни тоста.
 */
export interface IMessageApi {
    // Свойства-стрелки: `window` раздаёт их как есть (`const { showErrorMessage } = vscode.window`).
    readonly showInformationMessage: (message: string, ...rest: unknown[]) => Thenable<unknown>;
    readonly showWarningMessage: (message: string, ...rest: unknown[]) => Thenable<unknown>;
    readonly showErrorMessage: (message: string, ...rest: unknown[]) => Thenable<unknown>;
}

export interface IParsedMessageArgs {
    readonly modal: boolean;
    readonly detail?: string;
    readonly items: readonly (string | vscode.MessageItem)[];
}

/** Признак эталона: у `MessageItem` есть `title`, у `MessageOptions` нет. */
function isMessageItem(value: unknown): value is vscode.MessageItem {
    return typeof value === "object" && value !== null && "title" in value;
}

function nonEmpty(text: unknown): string | undefined {
    return typeof text === "string" && text !== "" ? text : undefined;
}

export function parseMessageArgs(first: unknown, rest: readonly unknown[]): IParsedMessageArgs {
    if (typeof first === "string" || isMessageItem(first)) {
        return { modal: false, items: [first, ...(rest as readonly (string | vscode.MessageItem)[])] };
    }
    // Что это именно объект, не проверяем: поля читаются через `?.`, и на мусоре результат
    // тот же — «опций нет».
    const options = first as vscode.MessageOptions | undefined;
    return {
        modal: options?.modal === true,
        detail: nonEmpty(options?.detail),
        items: rest as readonly (string | vscode.MessageItem)[],
    };
}

export function toWireMessageItem(item: string | vscode.MessageItem): IWireMessageItem {
    if (typeof item === "string") return { title: item, isCloseAffordance: false };
    return { title: item.title, isCloseAffordance: item.isCloseAffordance === true };
}

export function createMessageApi(rpc: SubprocessRpc): IMessageApi {
    const show = async (
        severity: WireMessageSeverity,
        // `unknown`: расширение на JS вправе прислать что угодно.
        message: unknown,
        first: unknown,
        rest: readonly unknown[],
    ): Promise<unknown> => {
        const parsed = parseMessageArgs(first, rest);
        const result = parseWireShowMessageResult(
            await rpc.request("window.showMessage", {
                severity,
                // Без проверки типа: у строки строковое представление — она сама.
                message: String(message),
                modal: parsed.modal,
                detail: parsed.detail,
                items: parsed.items.map(toWireMessageItem),
            }),
        );
        if (result.index === null) return undefined;
        // Индекс за пределами — ответ не про этот показ: дырку в кнопках не отдаём.
        return parsed.items.at(result.index);
    };

    return {
        showInformationMessage: (message, first?, ...rest) => show("info", message, first, rest),
        showWarningMessage: (message, first?, ...rest) => show("warn", message, first, rest),
        showErrorMessage: (message, first?, ...rest) => show("error", message, first, rest),
    };
}
