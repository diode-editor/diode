import type * as vscode from "vscode";

import { Emitter } from "../../../base/common/event.ts";

import type { IDiskFileSystem } from "./extHostDisk.ts";
import { FileSystemError } from "./vscodeTypes.ts";

/**
 * `vscode.workspace.fs` на стороне subprocess.
 *
 * Схему `file` обслуживает локальный диск субпроцесса ({@link IDiskFileSystem},
 * привязка к `node:fs` — `api/node/extHostDisk.ts`): целевой файл живёт на той
 * же машине и не является открытым буфером ядра, поэтому RPC не нужен (в
 * отличие от will-save, который ходит за текстом активного документа на хост).
 *
 * Обслуживаем **только схему `file`**: в VS Code это роутер по `uri.scheme`
 * (`vscode-remote:`, `vscode-vfs:`, кастомные провайдеры), у нас же есть лишь
 * локальный диск. Прочие схемы получают `FileSystemError.Unavailable` — честный
 * отказ вместо чтения/записи мусора мимо схемы.
 *
 * Ошибки диска приходят {@link FileSystemError} с тем же `code`, что и в
 * VS Code, чтобы расширения ловили их по `err.code === "FileNotFound"`.
 */
export type IFileSystemNamespace = Pick<
    vscode.FileSystem,
    | "stat"
    | "readFile"
    | "writeFile"
    | "createDirectory"
    | "readDirectory"
    | "delete"
    | "rename"
    | "copy"
    | "isWritableFileSystem"
>;

/**
 * Гейт схемы для операций, которые умеет только локальный диск (`stat`, `writeFile`).
 *
 * Без этого гейта промах тихий и разрушительный: `fsPath` у не-file схемы не бросает,
 * а отдаёт путь как есть (`untitled:Untitled-1` → `"Untitled-1"`), поэтому `writeFile`
 * создавал бы `$CWD/Untitled-1` вместо ошибки.
 */
function assertFileScheme(uri: vscode.Uri): void {
    if (uri.scheme !== "file") throw FileSystemError.Unavailable(uri);
}

/**
 * Реестр `FileSystemProvider`'ов, зарегистрированных расширениями субпроцесса
 * (`workspace.registerFileSystemProvider`).
 *
 * Живёт здесь, а не в `workspaceNamespace`, чтобы роутинг `workspace.fs` по схеме
 * тестировался без RPC: сам реестр — чистая логика, а проводка событий на хост
 * остаётся у namespace'а, у которого есть `rpc`.
 */
export class SubprocessFileSystemProviders {
    private readonly providers = new Map<string, vscode.FileSystemProvider>();
    private readonly onDidChangeSchemesEmitter = new Emitter<void>();
    private readonly onDidChangeFileEmitter = new Emitter<vscode.Uri[]>();
    private readonly changeSubscriptions = new Map<string, vscode.Disposable>();

    /** Регистрирует провайдера схемы. Занятая схема — ошибка, как в VS Code. */
    public register(scheme: string, provider: vscode.FileSystemProvider): { dispose: () => void } {
        if (this.providers.has(scheme)) {
            throw new Error(`A filesystem provider for the scheme '${scheme}' is already registered.`);
        }
        this.providers.set(scheme, provider);
        // Провайдер сообщает об изменениях сам (для git: — сдвинулся HEAD/индекс);
        // пересылаем это наружу, чтобы ядро сбросило кэш оригиналов.
        this.changeSubscriptions.set(
            scheme,
            provider.onDidChangeFile((events) => {
                const uris = events.map((e) => e.uri);
                if (uris.length === 0) return;
                this.onDidChangeFileEmitter.fire(uris);
            }),
        );
        this.fireSchemesChanged();
        return {
            dispose: () => {
                if (this.providers.get(scheme) !== provider) return;
                this.providers.delete(scheme);
                this.changeSubscriptions.get(scheme)?.dispose();
                this.changeSubscriptions.delete(scheme);
                this.fireSchemesChanged();
            },
        };
    }

    public get(scheme: string): vscode.FileSystemProvider | undefined {
        return this.providers.get(scheme);
    }

    /** Схемы, которые субпроцесс готов обслуживать (снимок для хоста). */
    public schemes(): string[] {
        return [...this.providers.keys()];
    }

    public readonly onDidChangeSchemes = this.onDidChangeSchemesEmitter.event;

    public readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

    private fireSchemesChanged(): void {
        this.onDidChangeSchemesEmitter.fire();
    }
}

export function createFileSystemNamespace(
    disk: IDiskFileSystem,
    providers?: SubprocessFileSystemProviders,
): IFileSystemNamespace {
    /**
     * Роутер по схеме — та же роль, что у `workspace.fs` в VS Code. `file` идёт
     * на локальный диск, прочие схемы — зарегистрированному провайдеру
     * расширения; схема без провайдера получает честный `Unavailable`.
     */
    async function readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (uri.scheme !== "file") {
            const provider = providers?.get(uri.scheme);
            if (provider === undefined) throw FileSystemError.Unavailable(uri);
            return await provider.readFile(uri);
        }
        return disk.readFile(uri);
    }

    return {
        stat: async (uri) => {
            assertFileScheme(uri);
            return await disk.stat(uri);
        },
        readFile,
        writeFile: async (uri, content) => {
            assertFileScheme(uri);
            await disk.writeFile(uri, content);
        },
        createDirectory: async (uri) => {
            assertFileScheme(uri);
            await disk.createDirectory(uri);
        },
        readDirectory: async (uri) => {
            assertFileScheme(uri);
            return await disk.readDirectory(uri);
        },
        delete: async (uri, options) => {
            assertFileScheme(uri);
            await disk.delete(uri, options);
        },
        rename: async (source, target, options) => {
            assertFileScheme(source);
            assertFileScheme(target);
            await disk.rename(source, target, options);
        },
        copy: async (source, target, options) => {
            assertFileScheme(source);
            assertFileScheme(target);
            await disk.copy(source, target, options);
        },
        // Единственная схема, которую мы обслуживаем сами, — `file`, и она
        // записываема. Про чужую схему честно `undefined` («редактор не знает
        // такой ФС»): провайдер расширения отдаёт нам только чтение, и врать
        // про его записываемость нельзя ни `true`, ни `false`.
        isWritableFileSystem: (scheme: string): boolean | undefined => (scheme === "file" ? true : undefined),
    };
}
