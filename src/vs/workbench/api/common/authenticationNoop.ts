import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * Без namespace'а `hashicorp.terraform` падал в `activate()` и уносил hover и
 * диагностики. Формы — эталонные; `createIfNone`/`forceNewSession` — отказ с
 * причиной, а не `undefined`: перегрузка обещает сессию, и `session.account`
 * упал бы у расширения невнятным `TypeError`.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

export function createAuthenticationNoop(rpc: SubprocessRpc): typeof vscode.authentication {
    const reported = new Set<string>();

    // Главное — первым: строка Output обрезается шириной панели.
    function reportUnsupported(id: string, label: string): void {
        if (reported.has(id)) return;
        reported.add(id);
        rpc.notify("output.append", {
            channel: OUTPUT_CHANNEL,
            label: OUTPUT_LABEL,
            level: "warn",
            value: `вход через "${label}" (${id}) в TUI пока не поддержан — сессий не будет, остальное расширение работает`,
        });
    }

    function getSession(
        providerId: string,
        _scopeListOrRequest: readonly string[] | vscode.AuthenticationWwwAuthenticateRequest,
        options?: vscode.AuthenticationGetSessionOptions,
    ): Promise<vscode.AuthenticationSession | undefined> {
        // Порядок и тексты проверок — эталонные (`doGetSession`).
        if (options?.forceNewSession && options.silent) {
            return Promise.reject(
                new Error(
                    "Invalid combination of options. Please remove one of the following: forceNewSession, silent",
                ),
            );
        }
        if (options?.createIfNone && options.silent) {
            return Promise.reject(
                new Error("Invalid combination of options. Please remove one of the following: createIfNone, silent"),
            );
        }
        if (options?.createIfNone || options?.forceNewSession) {
            return Promise.reject(new Error(`вход через "${providerId}" в TUI пока не поддержан`));
        }
        return Promise.resolve(undefined);
    }

    return {
        // Перегрузка, что обещает сессию, всегда отклоняется — компилятор этого из ветвления не выведет.
        getSession: getSession as typeof vscode.authentication.getSession,
        getAccounts: (): Promise<readonly vscode.AuthenticationSessionAccountInformation[]> => Promise.resolve([]),
        onDidChangeSessions: new EventEmitter<vscode.AuthenticationSessionsChangeEvent>().event,
        registerAuthenticationProvider: (
            id: string,
            label: string,
            _provider: vscode.AuthenticationProvider,
            _options?: vscode.AuthenticationProviderOptions,
        ): vscode.Disposable => {
            reportUnsupported(id, label);
            return new DisposableImpl(() => undefined);
        },
    };
}
