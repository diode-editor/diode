import type * as vscode from "vscode";

import { implementsApi } from "./apiSurface.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";
import { DisposableImpl } from "./vscodeTypes.ts";

type CommandHandler = (...args: unknown[]) => unknown;

/**
 * `apiCommands` (`vscode.open`…) run right here and are not declared to the host;
 * the extension id from `owner` ends up in stderr warnings. `processArgument` is upstream's argument
 * processor: each argument of a command the host runs is turned back into an extension object (a tree row).
 */
export function buildCommandsNamespace(
    rpc: SubprocessRpc,
    getActiveTextEditor?: () => vscode.TextEditor | undefined,
    owner?: ExtensionOwner,
    apiCommands: ReadonlyMap<string, CommandHandler> = new Map(),
    processArgument: (arg: unknown) => unknown = (arg) => arg,
): typeof vscode.commands {
    /**
     * A stack per id, the last one in force, as the host's `CommandRegistry`: disposing a repeated
     * registration brings the previous one back. Deviation: upstream throws `already exists` on the repeat.
     */
    const localCommands = new Map<string, CommandHandler[]>();

    rpc.handleRequest("commands.executeCommand", (params): unknown => {
        const { id, args } = parseExecuteParams(params);
        const handler = localCommands.get(id)?.at(-1);
        if (handler === undefined) {
            throw new Error(`command "${id}" not found in subprocess`);
        }
        return handler(...args.map(processArgument));
    });

    const addCommand = (
        id: string,
        callback: (...args: unknown[]) => unknown,
        thisArg: unknown,
        textEditor: boolean,
    ): vscode.Disposable => {
        const bound: CommandHandler = thisArg != null ? (...args) => callback.apply(thisArg, args) : callback;
        const stack = localCommands.get(id) ?? [];
        stack.push(bound);
        localCommands.set(id, stack);
        rpc.notify("commands.registerCommand", textEditor ? { id, textEditor } : { id });
        return new DisposableImpl(() => {
            // A second dispose finds nothing, and must not take someone else's registration.
            const index = stack.lastIndexOf(bound);
            if (index < 0) return;
            stack.splice(index, 1);
            // The host's proxy calls by id, so it stays while any registration of this id is left.
            if (stack.length === 0) {
                localCommands.delete(id);
                rpc.notify("commands.unregisterCommand", { id });
            }
        });
    };

    const registerCommand = (
        id: string,
        callback: (...args: unknown[]) => unknown,
        thisArg?: unknown,
    ): vscode.Disposable => addCommand(id, callback, thisArg, false);

    /** Upstream `ExtHostTextEditors.registerTextEditorCommand`: what the callback returns does not delay the edit. */
    const registerTextEditorCommand = (
        id: string,
        callback: (editor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: unknown[]) => void,
        thisArg?: unknown,
    ): vscode.Disposable => {
        // Owner is captured at registration: by execution time the surrounding owner is gone.
        const extensionId = owner?.current;
        const tag = extensionId === undefined ? "" : `[${extensionId}] `;
        const run = (...args: unknown[]): unknown => {
            const editor = getActiveTextEditor?.();
            if (editor === undefined) {
                console.warn(`${tag}Cannot execute text editor command "${id}": no active text editor`);
                return undefined;
            }
            return editor
                .edit((edit) => {
                    callback.call(thisArg, editor, edit, ...args);
                })
                .then(
                    (applied) => {
                        if (!applied) console.warn(`${tag}Edits from command "${id}" were not applied.`);
                    },
                    (error: unknown) => {
                        console.warn(`${tag}An error occurred while running command "${id}"`, error);
                    },
                );
        };
        return addCommand(id, run, undefined, true);
    };

    const executeCommand = <T = unknown>(id: string, ...args: unknown[]): Promise<T> => {
        const handler = localCommands.get(id)?.at(-1) ?? apiCommands.get(id);
        if (handler !== undefined) {
            // Inside the executor: a synchronous API-command refusal becomes a promise rejection, as upstream.
            return new Promise<T>((resolve) => {
                resolve(handler(...args) as T);
            });
        }
        return rpc.request("commands.executeCommand", { id, args }) as Promise<T>;
    };

    // Like upstream, the API commands stay out: they live here, the list comes from the core registry.
    const getCommands = async (filterInternal = false): Promise<string[]> => {
        const ids = await rpc.request("commands.getCommands");
        return filterInternal ? ids.filter((id) => !id.startsWith("_")) : [...ids];
    };

    return implementsApi<typeof vscode.commands>()({
        registerCommand,
        registerTextEditorCommand,
        executeCommand,
        getCommands,
    });
}

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
