import type * as vscode from "vscode";

import type { RpcEndpoint } from "./rpcEndpoint.ts";
import { InputBoxValidationSeverity } from "./vscodeTypes.ts";
import {
    type IWireQuickPickItem,
    type IWireValidationMessage,
    parseWireInputBoxResult,
    parseWireQuickPickResult,
    type WireValidationSeverity,
} from "./wireTypes.ts";

/**
 * `window.showInputBox` / `window.showQuickPick` на стороне subprocess'а.
 *
 * UI живёт у хоста (общий QuickInput-оверлей приложения), поэтому оба вызова —
 * это один запрос по проводу и ожидание ответа. Показ адресуется `handle`,
 * уникальным в рамках subprocess'а: по нему токен отмены расширения снимает
 * показ, а хост на каждое изменение значения спрашивает `validateInput`
 * обратным запросом.
 *
 * Ответ на пикер приходит ИНДЕКСАМИ в присланном массиве — расширение обязано
 * получить обратно свои собственные предметы (`showQuickPick<T>` возвращает
 * `T`), а пересобранный по проводу предмет ими бы не был.
 */
export interface IQuickInputApi {
    showInputBox(options?: vscode.InputBoxOptions, token?: vscode.CancellationToken): Thenable<string | undefined>;
    showQuickPick(
        items: unknown,
        options?: vscode.QuickPickOptions,
        token?: vscode.CancellationToken,
    ): Thenable<unknown>;
}

/** Исход `validateInput` расширения → сообщение на проводе. */
export function toWireValidation(
    outcome: string | vscode.InputBoxValidationMessage | undefined | null,
): IWireValidationMessage | null {
    if (outcome === undefined || outcome === null) return null;
    if (typeof outcome === "string") {
        // Голая строка — всегда ошибка (так задокументировано в vscode.d.ts).
        return outcome === "" ? null : { message: outcome, severity: "error" };
    }
    if (typeof outcome.message !== "string" || outcome.message === "") return null;
    return { message: outcome.message, severity: toWireSeverity(outcome.severity) };
}

/**
 * Строгость приходит от расширения, поэтому сравниваем ЧИСЛА: у расширения свой
 * `vscode.InputBoxValidationSeverity` из его копии `vscode.d.ts`, общего enum-типа
 * с нашим у него нет, а значения одни и те же.
 */
function toWireSeverity(severity: number | undefined): WireValidationSeverity {
    if (severity === InputBoxValidationSeverity.Warning) return "warning";
    if (severity === InputBoxValidationSeverity.Info) return "info";
    return "error";
}

/**
 * Предмет списка → строка на проводе. Строковый пункт сам себе лейбл.
 *
 * `detail` отдельной строкой под пунктом наш однострочный ряд не умеет, поэтому
 * он показывается НА МЕСТЕ описания — но только когда описания нет: при обоих
 * заполненных полях описание важнее (docs/public/API-COVERAGE.md).
 */
export function toWireQuickPickItem(item: string | vscode.QuickPickItem): IWireQuickPickItem {
    if (typeof item === "string") return { label: item };
    const description = item.description !== undefined && item.description !== "" ? item.description : item.detail;
    return {
        label: item.label,
        ...(description !== undefined && description !== "" ? { description } : {}),
    };
}

export function createQuickInputApi(rpc: RpcEndpoint): IQuickInputApi {
    let nextHandle = 1;
    /**
     * Валидаторы живых показов по handle. Map, а не один слот: ничто не мешает
     * расширению держать два `showInputBox` одновременно (второй перехватит
     * оверлей, но запрос валидации на первый ещё может быть в полёте).
     */
    const validators = new Map<number, (value: string) => unknown>();

    rpc.handleRequest("window.inputBox.validate", async (params): Promise<IWireValidationMessage | null> => {
        const p = params as { handle?: unknown; value?: unknown };
        if (typeof p.handle !== "number" || typeof p.value !== "string") return null;
        const validate = validators.get(p.handle);
        if (validate === undefined) return null;
        // Расширение вправе отвечать и синхронно, и промисом — await ровняет оба.
        const outcome = (await validate(p.value)) as string | vscode.InputBoxValidationMessage | undefined | null;
        return toWireValidation(outcome);
    });

    /**
     * Подписывает токен расширения на снятие показа. Возвращает функцию отписки:
     * жить дольше самого показа подписка не должна.
     */
    const bindCancellation = (handle: number, token: vscode.CancellationToken | undefined): (() => void) => {
        if (token === undefined) return () => undefined;
        const subscription = token.onCancellationRequested(() => {
            rpc.notify("window.quickInput.cancel", { handle });
        });
        return () => {
            subscription.dispose();
        };
    };

    return {
        showInputBox: async (options, token) => {
            if (token?.isCancellationRequested === true) return undefined;
            const handle = nextHandle++;
            // Метод берём из опций расширения — привязываем к их объекту, чтобы
            // `this` внутри валидатора остался тем, на что расширение рассчитывает.
            const validate =
                options?.validateInput !== undefined
                    ? (value: string): unknown => options.validateInput?.(value)
                    : undefined;
            if (validate !== undefined) validators.set(handle, validate);
            const unbind = bindCancellation(handle, token);
            try {
                const result = parseWireInputBoxResult(
                    await rpc.request("window.showInputBox", {
                        handle,
                        ...(options?.title !== undefined ? { title: options.title } : {}),
                        ...(options?.prompt !== undefined ? { prompt: options.prompt } : {}),
                        ...(options?.placeHolder !== undefined ? { placeHolder: options.placeHolder } : {}),
                        ...(options?.value !== undefined ? { value: options.value } : {}),
                        validates: validate !== undefined,
                    }),
                );
                return result.value ?? undefined;
            } finally {
                validators.delete(handle);
                unbind();
            }
        },

        showQuickPick: async (items, options, token) => {
            const canPickMany = options?.canPickMany === true;
            // Список, приходящий промисом, ЖДЁМ и показываем уже заполненным:
            // пустой оверлей с индикатором загрузки — состояние объектной формы
            // пикера, которой у нас нет.
            const resolved = (await Promise.resolve(items)) as readonly (string | vscode.QuickPickItem)[];
            if (token?.isCancellationRequested === true) return undefined;
            const handle = nextHandle++;
            const unbind = bindCancellation(handle, token);
            try {
                const result = parseWireQuickPickResult(
                    await rpc.request("window.showQuickPick", {
                        handle,
                        ...(options?.title !== undefined ? { title: options.title } : {}),
                        ...(options?.placeHolder !== undefined ? { placeHolder: options.placeHolder } : {}),
                        canPickMany,
                        items: resolved.map(toWireQuickPickItem),
                        picked: pickedIndices(resolved, canPickMany),
                    }),
                );
                if (result.indices === null) return undefined;
                // Индекс за пределами списка — ответ не про этот показ; выбрасываем,
                // иначе расширение получило бы `undefined` в массиве предметов.
                const picked = result.indices
                    .filter((index) => index < resolved.length)
                    .map((index) => resolved[index]);
                if (canPickMany) return picked;
                return picked.at(0);
            } finally {
                unbind();
            }
        },
    };
}

/** Индексы предотмеченных пунктов (`QuickPickItem.picked`); без canPickMany — пусто. */
function pickedIndices(items: readonly (string | vscode.QuickPickItem)[], canPickMany: boolean): number[] {
    if (!canPickMany) return [];
    const indices: number[] = [];
    for (const [index, item] of items.entries()) {
        if (typeof item !== "string" && item.picked === true) indices.push(index);
    }
    return indices;
}
