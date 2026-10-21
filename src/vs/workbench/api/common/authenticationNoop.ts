import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * Without the namespace `hashicorp.terraform` crashed in `activate()` and took hover and
 * diagnostics down with it. Shapes follow upstream; `createIfNone`/`forceNewSession` reject with
 * a reason rather than return `undefined`: that overload promises a session, and `session.account`
 * would fail in the extension with an obscure `TypeError`.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

export function createAuthenticationNoop(rpc: SubprocessRpc): typeof vscode.authentication {
    const reported = new Set<string>();

    // The essential part first: an Output line is clipped to the panel width.
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
        // Order and texts of the checks follow upstream (`doGetSession`).
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
        // The overload that promises a session always rejects; the compiler can't infer that from the branching.
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
