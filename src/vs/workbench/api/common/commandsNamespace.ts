import type * as vscode from "vscode";

import { implementsApi } from "./apiSurface.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";
import { DisposableImpl } from "./vscodeTypes.ts";

type CommandHandler = (...args: unknown[]) => unknown;

/**
 * `apiCommands` (`vscode.open`…) исполняются здесь же и хосту не объявляются;
 * id расширения из `owner` попадает в предупреждения в stderr.
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
            // Повторный register тем же id мог перезаписать колбэк — чужой dispose не должен его убрать.
            if (localCommands.get(id) === bound) {
                localCommands.delete(id);
                rpc.notify("commands.unregisterCommand", { id });
            }
        });
    };

    // Builder — пустышка: известные потребители (`basedpyright.organizeimports`)
    // читают только `editor.document` и шлют запрос серверу сами.
    const registerTextEditorCommand = (
        id: string,
        callback: (editor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: unknown[]) => void,
        thisArg?: unknown,
    ): vscode.Disposable => {
        // Владелец — в момент регистрации: при исполнении окружающего владельца уже нет.
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
            // Внутри executor'а: синхронный отказ API-команды уходит отказом промиса, как у эталона.
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
