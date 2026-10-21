import type * as vscode from "vscode";

import type { ICancellationToken } from "../../../base/common/cancellation.ts";

import { CancellationTokenSource } from "./vscodeTypes.ts";

/** Our own token cannot be handed out directly: extensions expect vscode `Event` semantics (`thisArgs`, `disposables`). */
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
        // Unsubscribing from the transport token changes nothing observable (it lives exactly until the reply) — it only prevents leaks.
        // Stryker disable BlockStatement,CallExpression: see above
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
        // Stryker disable next-line BlockStatement: subscription cleanup, see toVscodeCancellationToken
    } finally {
        // Stryker disable next-line CallExpression: same as above
        cancel.dispose();
    }
}
