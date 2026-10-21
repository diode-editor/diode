import { existsSync } from "node:fs";
import { stat, unlink, writeFile } from "node:fs/promises";

import * as vscode from "vscode";
import {
    CancellationToken,
    LanguageClient,
    type LanguageClientOptions,
    type ProvideCodeActionsSignature,
    type ServerOptions,
} from "vscode-languageclient/node";

import { needsNoopOrganizeImports } from "./lib/organizeImports.ts";
import { createRefactoringEditsMiddleware, type RefactoringEditsHost } from "./lib/refactoringEdits.ts";
import { LANGUAGE_SERVERS, resolveServerCommand } from "./lib/resolveServer.ts";

/** Распаковка вшитого сервера стартует при регистрации builtin'ов — активация может её обогнать. */
const BUNDLED_WAIT_MS = 5_000;
const BUNDLED_POLL_MS = 100;

/**
 * Пути вшитого сервера и режим рантайма инжектирует host переопределениями
 * дефолтов настроек (builtinConfigInjection в main.ts diode).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("diode.lsp.typescript");
    if (!configuration.get<boolean>("enabled", true)) return;
    const settingPath = configuration.get<string>("serverPath", "");
    const bundledServerPath = configuration.get<string>("bundledServerPath", "");
    const bundledTsserverPath = configuration.get<string>("bundledTsserverPath", "");
    const serverRuntime = configuration.get<string>("serverRuntime", "node");
    const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const runtime = { command: process.execPath, runAsNodeFlag: serverRuntime === "diode-as-node" };

    for (const spec of LANGUAGE_SERVERS) {
        const outputChannel = vscode.window.createOutputChannel(spec.displayName);

        // Кэш публикуется атомарным rename: existsSync entry = готовность.
        const hasEarlierCandidate =
            (settingPath !== "" && existsSync(settingPath)) ||
            workspaceRoots.some((root) => existsSync(`${root}/node_modules/typescript-language-server/lib/cli.mjs`));
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

        // Воркспейсный TypeScript сервер уважает сам. Для вшитого — без ATA:
        // typingsInstaller не пакуется, третий уровень форков + npm не нужен.
        const tsserverPath =
            configuration.get<string>("tsserverPath", "") || (resolved.isBundled ? bundledTsserverPath : "");
        const initializationOptions = {
            ...(tsserverPath !== "" ? { tsserver: { path: tsserverPath } } : {}),
            ...(resolved.isBundled ? { disableAutomaticTypingAcquisition: true } : {}),
        };
        // Middleware уходит в опции до создания клиента.
        const clientRef: { current?: LanguageClient } = {};
        const refactoringEdits = createRefactoringEditsMiddleware({
            ...refactoringFiles,
            applyRefactoringEdit: async (params) => {
                if (clientRef.current === undefined) return false;
                const edit = await clientRef.current.protocol2CodeConverter.asWorkspaceEdit(params.edit);
                return vscode.workspace.applyEdit(edit, { isRefactoring: true });
            },
        });
        const serverOptions: ServerOptions = {
            command: server.command,
            args: [...server.args],
            options: { env: { ...server.env } },
        };
        const clientOptions: LanguageClientOptions = {
            documentSelector: spec.languageIds.map((language) => ({ scheme: "file", language })),
            // Ошибки конвертации (p2c.asDiagnostics) клиент пишет ТОЛЬКО сюда —
            // no-op канал молча терял бы их.
            outputChannel,
            progressOnInitialization: true,
            ...(Object.keys(initializationOptions).length > 0 ? { initializationOptions } : {}),
            middleware: {
                provideCodeActions: withNoopOrganizeImports,
                executeCommand: (command, args, next) => refactoringEdits.executeCommand(command, args, next),
                workspace: {
                    handleApplyEdit: (params, next) =>
                        refactoringEdits.handleApplyEdit(params, (edit) => next(edit, CancellationToken.None)),
                },
            },
        };

        const client = new LanguageClient(spec.id, spec.displayName, serverOptions, clientOptions);
        clientRef.current = client;
        context.subscriptions.push(client);
        // Активация не блокируется на initialize. withProgress — спиннер виден,
        // даже если сервер не шлёт свой work-done прогресс.
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

/** Пустой edit применяется без правок и без шага отмены; почему — `lib/organizeImports.ts`. */
async function withNoopOrganizeImports(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
    next: ProvideCodeActionsSignature,
): Promise<(vscode.Command | vscode.CodeAction)[] | null | undefined> {
    const actions = await next(document, range, context, token);
    const kinds = (actions ?? []).map((action) =>
        action instanceof vscode.CodeAction ? action.kind?.value : undefined,
    );
    if (!needsNoopOrganizeImports(context.only?.value, kinds)) return actions;
    const noop = new vscode.CodeAction("Organize Imports", vscode.CodeActionKind.SourceOrganizeImports.append("ts"));
    noop.edit = new vscode.WorkspaceEdit();
    return [...(actions ?? []), noop];
}

const refactoringFiles: Omit<RefactoringEditsHost, "applyRefactoringEdit"> = {
    now: () => Date.now(),
    stat: (filePath) =>
        stat(filePath).then(
            (s) => ({ size: s.size, birthtimeMs: s.birthtimeMs, ctimeMs: s.ctimeMs }),
            () => null,
        ),
    unlink: (filePath) => unlink(filePath),
    writeEmpty: (filePath) => writeFile(filePath, ""),
    isOpen: (uri) => vscode.workspace.textDocuments.some((document) => document.uri.toString() === uri),
};

/** Возвращается и по таймауту. */
async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (existsSync(filePath)) return;
        await new Promise((resolve) => setTimeout(resolve, BUNDLED_POLL_MS));
    }
}
