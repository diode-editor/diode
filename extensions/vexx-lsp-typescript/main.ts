import { existsSync } from "node:fs";

import * as vscode from "vscode";
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node";

import { LANGUAGE_SERVERS, resolveServerCommand } from "./lib/resolveServer.ts";

/**
 * Builtin-клиент языковых серверов: стоковый `vscode-languageclient` поверх
 * vexx `vscode`-стаба. Весь LSP-протокол, document sync с сервером и
 * publishDiagnostics обслуживает сам languageclient; диагностики доезжают до
 * squiggle + панели Problems через `languages.createDiagnosticCollection`,
 * go-to-definition — через `languages.registerDefinitionProvider` (F12).
 *
 * Активация ленивая (`onLanguage:*` в манифесте) — сервер не трогает старт
 * редактора. Резолв сервера — `lib/resolveServer.ts` (настройка serverPath →
 * workspace node_modules → PATH).
 */
export function activate(context: vscode.ExtensionContext): void {
    const configuration = vscode.workspace.getConfiguration("vexx.lsp.typescript");
    if (configuration.get<boolean>("enabled", true) !== true) return;
    const settingPath = configuration.get<string>("serverPath", "") ?? "";
    const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);

    for (const spec of LANGUAGE_SERVERS) {
        const server = resolveServerCommand(spec, settingPath, workspaceRoots, existsSync);
        const outputChannel = vscode.window.createOutputChannel(spec.displayName);
        if (server === null) {
            outputChannel.appendLine(`${spec.id}: language server executable not found — skipped`);
            continue;
        }

        // Воркспейсы без собственного TypeScript (песочницы тестов, чужие
        // проекты): путь к tsserver.js передаётся серверу через
        // initializationOptions.tsserver.path.
        const tsserverPath = configuration.get<string>("tsserverPath", "") ?? "";
        const serverOptions: ServerOptions = { command: server.command, args: [...server.args] };
        const clientOptions: LanguageClientOptions = {
            documentSelector: spec.languageIds.map((language) => ({ scheme: "file", language })),
            // Ошибки конвертации (p2c.asDiagnostics и т.п.) клиент пишет ТОЛЬКО
            // сюда — канал обязан быть настоящим, no-op молча терял бы их.
            outputChannel,
            ...(tsserverPath !== "" ? { initializationOptions: { tsserver: { path: tsserverPath } } } : {}),
        };

        const client = new LanguageClient(spec.id, spec.displayName, serverOptions, clientOptions);
        context.subscriptions.push(client);
        // Fire-and-forget: активация не блокируется на initialize сервера.
        client.start().then(
            () => {
                outputChannel.appendLine(`${spec.id}: language server started (${server.command})`);
            },
            (err: unknown) => {
                outputChannel.appendLine(`${spec.id}: failed to start: ${err instanceof Error ? err.message : String(err)}`);
            },
        );
    }
}
