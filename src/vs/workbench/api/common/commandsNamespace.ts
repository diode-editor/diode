import type * as vscode from "vscode";

import { implementsApi } from "./apiSurface.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";
import { DisposableImpl } from "./vscodeTypes.ts";

type CommandHandler = (...args: unknown[]) => unknown;

/**
 * `apiCommands` (`vscode.open`…) run right here and are not declared to the host;
 * the extension id from `owner` ends up in stderr warnings.
 */
export function buildCommandsNamespace(
    rpc: SubprocessRpc,
    getActiveTextEditor?: () => vscode.TextEditor | undefined,
    owner?: ExtensionOwner,
    apiCommands: ReadonlyMap<string, CommandHandler> = new Map(),
): typeof vscode.commands {
    const localCommands = new Map<string, CommandHandler>();

    rpc.handleRequest("commands.executeCommand", (params): unknown => {
        const { id, args } = parseExecuteParams(params);
        const handler = localCommands.get(id);
        if (handler === undefined) {
            throw new Error(`command "${id}" not found in subprocess`);
        }
        return handler(...args);
    });

    const registerCommand = (
        id: string,
        callback: (...args: unknown[]) => unknown,
        thisArg?: unknown,
    ): vscode.Disposable => {
        const bound: CommandHandler = thisArg != null ? (...args) => callback.apply(thisArg, args) : callback;
        localCommands.set(id, bound);
        rpc.notify("commands.registerCommand", { id });
        return new DisposableImpl(() => {
            // A repeated register with the same id may have replaced the callback; a stale dispose must not remove it.
            if (localCommands.get(id) === bound) {
                localCommands.delete(id);
                rpc.notify("commands.unregisterCommand", { id });
            }
        });
    };

    // The builder is a dummy: known consumers (`basedpyright.organizeimports`)
    // read only `editor.document` and send the request to the server themselves.
    const registerTextEditorCommand = (
        id: string,
        callback: (editor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: unknown[]) => void,
        thisArg?: unknown,
    ): vscode.Disposable => {
        // Owner is captured at registration: by execution time the surrounding owner is gone.
        const extensionId = owner?.current;
        const tag = extensionId === undefined ? "" : `[${extensionId}] `;
        return registerCommand(id, (...args: unknown[]): unknown => {
            const editor = getActiveTextEditor?.();
            if (editor === undefined) {
                console.warn(`${tag}Cannot execute text editor command "${id}": no active text editor`);
                return undefined;
            }
            callback.call(thisArg, editor, noopTextEditorEdit, ...args);
        });
    };

    const executeCommand = <T = unknown>(id: string, ...args: unknown[]): Promise<T> => {
        const handler = localCommands.get(id) ?? apiCommands.get(id);
        if (handler !== undefined) {
            // Inside the executor: a synchronous API-command refusal becomes a promise rejection, as upstream.
            return new Promise<T>((resolve) => {
                resolve(handler(...args) as T);
            });
        }
        return rpc.request("commands.executeCommand", { id, args }) as Promise<T>;
    };

    return implementsApi<typeof vscode.commands>()({
        registerCommand,
        registerTextEditorCommand,
        executeCommand,
    });
}

const noopTextEditorEdit: vscode.TextEditorEdit = {
    replace: (): void => undefined,
    insert: (): void => undefined,
    delete: (): void => undefined,
    setEndOfLine: (): void => undefined,
};

function parseExecuteParams(raw: unknown): { id: string; args: unknown[] } {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("commands.executeCommand: params must be an object");
    }
    const obj = raw as { id?: unknown; args?: unknown };
    if (typeof obj.id !== "string" || obj.id === "") {
        throw new Error("commands.executeCommand: id must be a non-empty string");
    }
    const args = Array.isArray(obj.args) ? (obj.args as unknown[]) : [];
    return { id: obj.id, args };
}
