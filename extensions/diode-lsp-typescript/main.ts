import { existsSync } from "node:fs";
import { stat, unlink, writeFile } from "node:fs/promises";

import * as vscode from "vscode";
import {
    CancellationToken,
    DidChangeConfigurationNotification,
    ExecuteCommandRequest,
    LanguageClient,
    type LanguageClientOptions,
    type ProvideCodeActionsSignature,
    type ServerOptions,
} from "vscode-languageclient/node";

import { needsNoopOrganizeImports } from "./lib/organizeImports.ts";
import { configFileFromProjectInfo, JS_TS_LANGUAGE_IDS } from "./lib/projectConfig.ts";
import {
    type IProjectStatusEditor,
    type IProjectStatusHost,
    PROJECT_STATUS_ITEM_ID,
    PROJECT_STATUS_ITEM_NAME,
    ProjectStatus,
} from "./lib/projectStatus.ts";
import { createRefactoringEditsMiddleware, type RefactoringEditsHost } from "./lib/refactoringEdits.ts";
import { LANGUAGE_SERVERS, resolveServerCommand } from "./lib/resolveServer.ts";
import { serverSettings, SYNCHRONIZED_SECTIONS } from "./lib/serverSettings.ts";

/** Bundled server extraction starts when builtins are registered; activation can overtake it. */
const BUNDLED_WAIT_MS = 5_000;
const BUNDLED_POLL_MS = 100;

/**
 * The host injects the bundled server paths and the runtime mode by overriding
 * setting defaults (builtinConfigInjection in diode's main.ts).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("diode.lsp.typescript");
    // The palette commands answer even without a server: "Could not determine TypeScript or JavaScript project".
    const projectClientRef: { current?: LanguageClient } = {};
    const projectStatus = new ProjectStatus(projectStatusHost(projectClientRef));
    context.subscriptions.push(projectStatus);
    for (const [id, handler] of Object.entries(projectStatus.commands())) {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }
    const updateProjectStatus = (): void => void projectStatus.update(activeEditor());
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateProjectStatus));
    updateProjectStatus();
    if (!configuration.get<boolean>("enabled", true)) {
        projectStatus.setFailed();
        return;
    }
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
            projectStatus.setFailed();
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
            // Sends on start and on each change of these sections; the payload comes from the middleware below.
            synchronize: { configurationSection: SYNCHRONIZED_SECTIONS },
            middleware: {
                provideCodeActions: withNoopOrganizeImports,
                // tsserver notices a new or deleted config by polling it (2 s) and loads the project in the
                // background; the server reports that load as "Initializing JS/TS language features…". Its end is
                // the moment the project of the active file may have changed without an editor switch.
                handleWorkDoneProgress: (token, params, next) => {
                    next(token, params);
                    if (params.kind === "end") void projectStatus.refresh();
                },
                executeCommand: (command, args, next) => refactoringEdits.executeCommand(command, args, next),
                workspace: {
                    // The stock payload copies the sections as they are and drops `false`; the server wants its own keys.
                    didChangeConfiguration: async () => {
                        const section = vscode.workspace.getConfiguration();
                        await clientRef.current?.sendNotification(DidChangeConfigurationNotification.type, {
                            settings: serverSettings((key, fallback) => section.get(key, fallback)),
                        });
                    },
                    handleApplyEdit: (params, next) =>
                        refactoringEdits.handleApplyEdit(params, (edit) => next(edit, CancellationToken.None)),
                },
            },
        };

        const client = new LanguageClient(spec.id, spec.displayName, serverOptions, clientOptions);
        clientRef.current = client;
        projectClientRef.current = client;
        context.subscriptions.push(client);
        // Activation does not block on initialize. withProgress shows a spinner
        // even if the server sends no work-done progress of its own.
        void vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `${spec.displayName}: starting language server…` },
            () =>
                client.start().then(
                    () => {
                        outputChannel.appendLine(`${spec.id}: language server started (${server.command})`);
                        projectStatus.setReady();
                    },
                    (err: unknown) => {
                        projectStatus.setFailed();
                        outputChannel.appendLine(
                            `${spec.id}: failed to start: ${err instanceof Error ? err.message : String(err)}`,
                        );
                    },
                ),
        );
    }
}

function activeEditor(): IProjectStatusEditor | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined) return undefined;
    const { uri, languageId } = document;
    return { uri: uri.toString(), scheme: uri.scheme, fsPath: uri.fsPath, languageId };
}

function projectStatusHost(clientRef: { readonly current?: LanguageClient }): IProjectStatusHost {
    return {
        createItem: () => {
            const item = vscode.languages.createLanguageStatusItem(PROJECT_STATUS_ITEM_ID, [...JS_TS_LANGUAGE_IDS]);
            item.name = PROJECT_STATUS_ITEM_NAME;
            return item;
        },
        projectInfo: async (documentUri) => {
            const client = clientRef.current;
            if (client?.isRunning() !== true) return undefined;
            try {
                const response: unknown = await client.sendRequest(ExecuteCommandRequest.type, {
                    command: "typescript.tsserverRequest",
                    arguments: ["projectInfo", { file: documentUri, needFileNameList: false }],
                });
                return configFileFromProjectInfo(response);
            } catch {
                return undefined;
            }
        },
        workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
        asRelativePath: (filePath) => vscode.workspace.asRelativePath(filePath),
        fileExists: (filePath) =>
            stat(filePath).then(
                () => true,
                () => false,
            ),
        createFile: (filePath, text) => {
            const uri = vscode.Uri.file(filePath);
            const edit = new vscode.WorkspaceEdit();
            // `contents`, not a text edit: tsserver reads the config from disk, and a text edit would stay in a dirty model.
            edit.createFile(uri, { contents: new TextEncoder().encode(text) });
            return vscode.workspace.applyEdit(edit);
        },
        openFile: async (filePath) => {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(document, vscode.window.activeTextEditor?.viewColumn);
        },
        showInformationMessage: (message, ...items) => vscode.window.showInformationMessage(message, ...items),
        showWarningMessage: (message) => void vscode.window.showWarningMessage(message),
    };
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
