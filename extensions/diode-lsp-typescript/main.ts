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

/** Bundled server extraction starts when builtins are registered; activation can overtake it. */
const BUNDLED_WAIT_MS = 5_000;
const BUNDLED_POLL_MS = 100;

/**
 * The host injects the bundled server paths and the runtime mode by overriding
 * setting defaults (builtinConfigInjection in diode's main.ts).
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

        // The cache is published by an atomic rename: existsSync of the entry means ready.
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

        // The server honors a workspace TypeScript by itself. For the bundled one, no ATA:
        // typingsInstaller is not packaged, and a third level of forks + npm is not needed.
        const tsserverPath =
            configuration.get<string>("tsserverPath", "") || (resolved.isBundled ? bundledTsserverPath : "");
        const initializationOptions = {
            ...(tsserverPath !== "" ? { tsserver: { path: tsserverPath } } : {}),
            ...(resolved.isBundled ? { disableAutomaticTypingAcquisition: true } : {}),
        };
        // Middleware goes into the options before the client is created.
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
            // The client writes conversion errors (p2c.asDiagnostics) ONLY here;
            // a no-op channel would silently lose them.
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
        // Activation does not block on initialize. withProgress shows a spinner
        // even if the server sends no work-done progress of its own.
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

/** An empty edit applies with no changes and no undo step; see `lib/organizeImports.ts` for why. */
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

/** Also resolves on timeout. */
async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (existsSync(filePath)) return;
        await new Promise((resolve) => setTimeout(resolve, BUNDLED_POLL_MS));
    }
}
