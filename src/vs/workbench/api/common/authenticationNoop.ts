import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * `vscode.authentication` как null-объект — до настоящих провайдеров входа
 * (вход в HCP Terraform и т. п., docs/TODO/Terraform.md).
 *
 * Отсутствие namespace'а убивало расширение ЦЕЛИКОМ: `hashicorp.terraform`
 * в `activate()` регистрирует свой провайдер и спрашивает сессию у панелей
 * HCP Terraform ещё до старта языкового сервера, и `Cannot read properties of
 * undefined` уносил с собой hover, автодополнение и диагностики.
 *
 * Что отвечает null-объект (форма — эталонная, `extHost.api.impl.ts` +
 * `mainThreadAuthentication.ts`):
 * - `getSession` без `createIfNone`/`forceNewSession` — `undefined`: сессии
 *   нет, как у человека, который не входил. Расширения так и проверяют
 *   «вошёл ли» (`await getSession(id, [], { createIfNone: false }) === undefined`).
 * - `createIfNone`/`forceNewSession` — отказ: войти негде. Эталон в этом месте
 *   спрашивает человека и при отказе бросает; у нас спрашивать нечем, поэтому
 *   отказ сразу и с причиной, а не `undefined` — контракт перегрузки обещает
 *   сессию, и `session.account` упал бы у расширения невнятным `TypeError`.
 * - Несовместимые с `silent` опции бросают эталонной ошибкой.
 * - `getAccounts` — пустой список, `onDidChangeSessions` не стреляет (сессий нет).
 * - `registerAuthenticationProvider` — `Disposable`; провайдер никто не зовёт.
 *   Человеку — одна warn-строка в Output на id провайдера за жизнь субпроцесса,
 *   иначе единственным следом остался бы `diode.log`.
 */

/** Канал панели Output для отказа: `extensions` уже в реестре ядра (label «Extensions»). */
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
        // Одна реализация на все перегрузки: та, что обещает сессию
        // (`createIfNone`/`forceNewSession`), всегда отклоняется — `undefined`
        // она не вернёт никогда, но компилятор этого из ветвления не выведет.
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
