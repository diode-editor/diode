import type * as vscode from "vscode";

import type { ICancellationToken } from "../../../base/common/cancellation.ts";

import { CancellationTokenSource } from "./vscodeTypes.ts";

/** Свой токен напрямую не отдать: расширения ждут vscode-семантику `Event` (`thisArgs`, `disposables`). */
export function toVscodeCancellationToken(token: ICancellationToken): {
    token: vscode.CancellationToken;
    dispose: () => void;
} {
    const source = new CancellationTokenSource();
    const subscription = token.onCancellationRequested(() => {
        source.cancel();
    });
    return {
        token: source.token,
        // Отписка от транспортного токена наблюдаемо ничего не меняет (он живёт ровно до ответа) — только не течь.
        // Stryker disable BlockStatement,CallExpression: см. выше
        dispose: (): void => {
            subscription.dispose();
            source.dispose();
        },
        // Stryker restore BlockStatement,CallExpression
    };
}

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
