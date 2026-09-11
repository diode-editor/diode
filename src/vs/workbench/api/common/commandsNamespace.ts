import type * as vscode from "vscode";

import type { RpcEndpoint } from "./rpcEndpoint.ts";
import { DisposableImpl } from "./vscodeTypes.ts";

type CommandHandler = (...args: unknown[]) => unknown;

/**
 * Реализация `vscode.commands` внутри subprocess'а — мост команд поверх
 * симметричного {@link RpcEndpoint}.
 *
 * Две стороны моста:
 * - **subprocess → host**: `registerCommand` кладёт колбэк в локальную Map и
 *   уведомляет хост (`commands.registerCommand`), чтобы тот завёл прокси в своём
 *   `CommandRegistry`; `executeCommand` для чужой (нелокальной) команды уходит
 *   `request`'ом на хост.
 * - **host → subprocess**: когда ядро исполняет прокси-команду (напр. палитра
 *   запускает `EditorConfig.generate`), хост шлёт `request commands.executeCommand`,
 *   который мы обрабатываем ниже, гоняя локальный колбэк.
 */
export function buildCommandsNamespace(
    rpc: RpcEndpoint,
    getActiveTextEditor?: () => vscode.TextEditor | undefined,
): typeof vscode.commands {
    const localCommands = new Map<string, CommandHandler>();

    // Входящий запрос от хоста: исполнить локально зарегистрированную команду.
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
            // Снимаем только свою регистрацию: повторный register тем же id мог
            // перезаписать колбэк — тогда чужой dispose не должен его убрать.
            if (localCommands.get(id) === bound) {
                localCommands.delete(id);
                rpc.notify("commands.unregisterCommand", { id });
            }
        }) as unknown as vscode.Disposable;
    };

    // Команда «только при активном редакторе» (семантика VS Code): без него —
    // предупреждение в stderr и no-op, с ним — колбэк получает редактор и
    // edit-builder. Builder у нас пустышка: применение батча правок шло бы через
    // `workspace.applyEdit`-путь, которого ещё нет (docs/TODO/LSP.md); известные
    // потребители (`basedpyright.organizeimports`) читают только `editor.document`
    // и шлют запрос серверу сами.
    const registerTextEditorCommand = (
        id: string,
        callback: (editor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: unknown[]) => void,
        thisArg?: unknown,
    ): vscode.Disposable => {
        return registerCommand(id, (...args: unknown[]): unknown => {
            const editor = getActiveTextEditor?.();
            if (editor === undefined) {
                console.warn(`Cannot execute text editor command "${id}": no active text editor`);
                return undefined;
            }
            return callback.call(thisArg, editor, noopTextEditorEdit, ...args);
        });
    };

    // Возвращаем Promise (совместим с `Thenable<T>` из типов vscode); точная
    // сигнатура стирается финальным кастом `as unknown as typeof vscode.commands`.
    const executeCommand = <T = unknown>(id: string, ...args: unknown[]): Promise<T> => {
        const handler = localCommands.get(id);
        if (handler !== undefined) {
            return Promise.resolve(handler(...args)) as Promise<T>;
        }
        return rpc.request("commands.executeCommand", { id, args }) as Promise<T>;
    };

    return {
        registerCommand,
        registerTextEditorCommand,
        executeCommand,
    } as unknown as typeof vscode.commands;
}

/** Инертный edit-builder для {@link buildCommandsNamespace registerTextEditorCommand}. */
const noopTextEditorEdit = {
    replace: (): void => undefined,
    insert: (): void => undefined,
    delete: (): void => undefined,
    setEndOfLine: (): void => undefined,
} as unknown as vscode.TextEditorEdit;

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
