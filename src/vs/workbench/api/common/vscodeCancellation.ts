import type * as vscode from "vscode";

import type { ICancellationToken } from "../../../base/common/cancellation.ts";

import { CancellationTokenSource } from "./vscodeTypes.ts";

/**
 * Переводит транспортный токен RPC в `vscode.CancellationToken`. Отдать свой
 * напрямую нельзя: расширения ждут vscode-семантику `Event` (`thisArgs`,
 * `disposables`), которую даёт только {@link CancellationTokenSource} из
 * vscodeTypes. Возвращённый `dispose` снимает подписку на транспортный токен —
 * запрос отработал, держать слушателя больше незачем.
 */
export function toVscodeCancellationToken(token: ICancellationToken): {
    token: vscode.CancellationToken;
    dispose: () => void;
} {
    const source = new CancellationTokenSource();
    // Уже отменённый токен зовёт слушателя синхронно — провайдер получит
    // отменённый токен, не успев начать (отмена обогнала запрос).
    const subscription = token.onCancellationRequested(() => {
        source.cancel();
    });
    return {
        token: source.token,
        // Уборка после отработавшего запроса: отписка от транспортного токена
        // наблюдаемого поведения не меняет (сам токен живёт ровно до ответа),
        // поэтому проверять тут нечего — только не течь.
        // Stryker disable BlockStatement,CallExpression: см. выше
        dispose: (): void => {
            subscription.dispose();
            source.dispose();
        },
        // Stryker restore BlockStatement,CallExpression
    };
}

/**
 * Зовёт провайдера расширения с vscode-токеном поверх транспортного и
 * отписывается, когда вызов отработал (успехом или отказом). Отказ провайдера
 * пробрасывается как есть.
 */
export async function callWithVscodeToken<T>(
    token: ICancellationToken,
    call: (token: vscode.CancellationToken) => T,
): Promise<Awaited<T>> {
    const cancel = toVscodeCancellationToken(token);
    try {
        return await call(cancel.token);
        // Stryker disable next-line BlockStatement: уборка подписки, см. toVscodeCancellationToken
    } finally {
        // Stryker disable next-line CallExpression: то же
        cancel.dispose();
    }
}
