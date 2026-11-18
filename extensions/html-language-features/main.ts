// Built-in HTML language features: upstream's `vscode.html-language-features`. `client/src/` and `server/src/` are a
// vendored copy (scripts/import-vscode-editor.mjs); this file stands in for upstream's `client/src/node/htmlClientMain.ts`,
// which finds the server next to its own package.json on disk. A builtin has no files on disk: the server is bundled
// into `ts-server.bundle` and the host hands its path in as a setting default (`builtinConfigInjection` in diode's
// main.ts). Telemetry is not wired: diode sends none.
import { existsSync } from "node:fs";

import * as vscode from "vscode";
import { LanguageClient, type ServerOptions, TransportKind } from "vscode-languageclient/node";

import { type AsyncDisposable, type LanguageClientConstructor, startClient } from "./client/src/htmlClient.ts";
import { getNodeFileFS } from "./client/src/node/nodeFs.ts";
import { completeSettingsSections } from "./lib/settingsSections.ts";

/** The bundle is unpacked when extensions start; the first html document can activate the client before that ends. */
const BUNDLED_WAIT_MS = 5_000;
const BUNDLED_POLL_MS = 100;

let client: AsyncDisposable | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const serverModule = vscode.workspace.getConfiguration("diode.html").get<string>("bundledServerPath", "");
    await waitForFile(serverModule, BUNDLED_WAIT_MS);

    // Upstream's options: a node module over IPC. `fork` runs it with the extension host's `process.execPath`: real
    // node in dev, the diode binary in node mode under SEA (the host process carries `DIODE_RUN_AS_NODE`).
    const serverOptions: ServerOptions = { module: serverModule, transport: TransportKind.ipc };
    const newLanguageClient: LanguageClientConstructor = (id, name, clientOptions) =>
        new LanguageClient(id, name, serverOptions, {
            ...clientOptions,
            middleware: {
                ...clientOptions.middleware,
                // The settings sections VS Code's other builtins declare (lib/settingsSections.ts).
                workspace: {
                    configuration: async (params, token, next) => {
                        const sections = await next(params, token);
                        const names = params.items.map((item) => item.section);
                        return Array.isArray(sections) ? completeSettingsSections(names, sections) : sections;
                    },
                },
            },
        });
    const timer = {
        setTimeout(callback: (...args: unknown[]) => void, ms: number, ...args: unknown[]): vscode.Disposable {
            const handle = setTimeout(callback, ms, ...args);
            return {
                dispose: () => {
                    clearTimeout(handle);
                },
            };
        },
    };

    // Passes the location of the localization bundle to the server, as upstream.
    process.env.VSCODE_L10N_BUNDLE_LOCATION = vscode.l10n.uri?.toString() ?? "";

    client = await startClient(context, newLanguageClient, { fileFs: getNodeFileFS(), TextDecoder, timer });
}

export async function deactivate(): Promise<void> {
    await client?.dispose();
    client = undefined;
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (filePath !== "" && !existsSync(filePath) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, BUNDLED_POLL_MS));
    }
}
