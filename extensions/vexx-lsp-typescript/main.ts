import { existsSync } from "node:fs";

import * as vscode from "vscode";
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node";

import { LANGUAGE_SERVERS, resolveServerCommand } from "./lib/resolveServer.ts";

/** Poll готовности вшитого сервера: распаковка стартует при регистрации builtin'ов. */
const BUNDLED_WAIT_MS = 5_000;
const BUNDLED_POLL_MS = 100;

/**
 * Builtin-клиент языковых серверов: стоковый `vscode-languageclient` поверх
 * vexx `vscode`-стаба. Весь LSP-протокол, document sync с сервером и
 * publishDiagnostics обслуживает сам languageclient; диагностики доезжают до
 * squiggle + панели Problems через `languages.createDiagnosticCollection`,
 * go-to-definition — через `languages.registerDefinitionProvider` (F12).
 *
 * Активация ленивая (`onLanguage:*` в манифесте) — сервер не трогает старт
 * редактора. Резолв сервера — `lib/resolveServer.ts`: настройка serverPath →
 * workspace node_modules → ВШИТЫЙ сервер из поставки (дефолт; пути и режим
 * рантайма инжектирует host через configDefaults — см. main.ts vexx,
 * builtinConfigInjection) → PATH. Сервер запускается нашим node-рантаймом
 * («как VS Code»): в dev/self-extract это настоящий node (`process.execPath`),
 * в SEA — vexx-бинарь в node-режиме (`DIODE_RUN_AS_NODE=1`, runAsNode.ts).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("vexx.lsp.typescript");
    if (configuration.get<boolean>("enabled", true) !== true) return;
    const settingPath = configuration.get<string>("serverPath", "") ?? "";
    const bundledServerPath = configuration.get<string>("bundledServerPath", "") ?? "";
    const bundledTsserverPath = configuration.get<string>("bundledTsserverPath", "") ?? "";
    const serverRuntime = configuration.get<string>("serverRuntime", "node") ?? "node";
    const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const runtime = { command: process.execPath, runAsNodeFlag: serverRuntime === "vexx-as-node" };

    for (const spec of LANGUAGE_SERVERS) {
        const outputChannel = vscode.window.createOutputChannel(spec.displayName);

        // Активация могла обогнать фоновую распаковку вшитого сервера (открыл
        // ts-файл в первую секунду): если более ранних кандидатов нет — коротко
        // ждём публикации кэша (rename атомарен: existsSync entry = готовность).
        const hasEarlierCandidate =
            (settingPath !== "" && existsSync(settingPath)) ||
            workspaceRoots.some((root) =>
                existsSync(`${root}/node_modules/typescript-language-server/lib/cli.mjs`),
            );
        if (!hasEarlierCandidate && bundledServerPath !== "" && !existsSync(bundledServerPath)) {
            await waitForFile(bundledServerPath, BUNDLED_WAIT_MS);
        }

        const resolved = resolveServerCommand(
            spec,
            settingPath,
            workspaceRoots,
            bundledServerPath,
            runtime,
            existsSync,
        );
        if (resolved === null) {
            outputChannel.appendLine(`${spec.id}: language server executable not found — skipped`);
            continue;
        }
        const server = resolved.command;

        // tsserver.path: явная настройка → (для вшитого сервера) вшитый tsserver.
        // Воркспейсный TypeScript сервер уважает сам («Using Typescript version
        // (workspace)»). Для вшитого пути выключаем ATA: typingsInstaller не
        // пакуется, а третий уровень форков + npm нам не нужен.
        const tsserverPath =
            (configuration.get<string>("tsserverPath", "") ?? "") ||
            (resolved.isBundled ? bundledTsserverPath : "");
        const initializationOptions = {
            ...(tsserverPath !== "" ? { tsserver: { path: tsserverPath } } : {}),
            ...(resolved.isBundled ? { disableAutomaticTypingAcquisition: true } : {}),
        };
        const serverOptions: ServerOptions = {
            command: server.command,
            args: [...server.args],
            options: { env: { ...server.env } },
        };
        const clientOptions: LanguageClientOptions = {
            documentSelector: spec.languageIds.map((language) => ({ scheme: "file", language })),
            // Ошибки конвертации (p2c.asDiagnostics и т.п.) клиент пишет ТОЛЬКО
            // сюда — канал обязан быть настоящим, no-op молча терял бы их.
            outputChannel,
            // Серверный прогресс initialize (если сервер его репортит) — поверх
            // нашего withProgress ниже, который виден всегда.
            progressOnInitialization: true,
            ...(Object.keys(initializationOptions).length > 0 ? { initializationOptions } : {}),
        };

        const client = new LanguageClient(spec.id, spec.displayName, serverOptions, clientOptions);
        context.subscriptions.push(client);
        // Fire-and-forget: активация не блокируется на initialize сервера.
        // Запуск обёрнут в withProgress — спиннер в статус-баре виден независимо
        // от того, шлёт ли сервер собственный work-done прогресс.
        void vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `${spec.displayName}: starting language server…` },
            () =>
                client.start().then(
                    () => {
                        outputChannel.appendLine(`${spec.id}: language server started (${server.command})`);
                    },
                    (err: unknown) => {
                        outputChannel.appendLine(
                            `${spec.id}: failed to start: ${err instanceof Error ? err.message : String(err)}`,
                        );
                    },
                ),
        );
    }
}

/** Ждёт появления файла poll'ом; возвращается и по успеху, и по таймауту. */
async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (existsSync(filePath)) return;
        await new Promise((resolve) => setTimeout(resolve, BUNDLED_POLL_MS));
    }
}
