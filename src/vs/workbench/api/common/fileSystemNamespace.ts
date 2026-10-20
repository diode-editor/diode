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
 * Это роутер по `uri.scheme`, как в VS Code: `file` — локальный диск, схема
 * провайдера расширения (`registerFileSystemProvider`) — сам провайдер (чтение,
 * stat и запись; прочие операции пока только у диска). Схема без провайдера
 * получает `FileSystemError.Unavailable` — честный отказ вместо чтения/записи
 * мусора мимо схемы.
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
    private readonly readonlySchemes = new Set<string>();
    private readonly onDidChangeSchemesEmitter = new Emitter<void>();
    private readonly onDidChangeFileEmitter = new Emitter<vscode.Uri[]>();
    private readonly changeSubscriptions = new Map<string, vscode.Disposable>();

    /**
     * Регистрирует провайдера схемы. Занятая схема — ошибка, как в VS Code.
     * Только для чтения — по `isReadonly` (эталон: `Readonly` в capabilities)
     * и, сверх эталона, у провайдера без `writeFile`: расширение на JS такого
     * провайдера собрать может, а писать в него нечем.
     */
    public register(
        scheme: string,
        provider: vscode.FileSystemProvider,
        options?: { readonly isReadonly?: unknown },
    ): { dispose: () => void } {
        if (this.providers.has(scheme)) {
            throw new Error(`A filesystem provider for the scheme '${scheme}' is already registered.`);
        }
        this.providers.set(scheme, provider);
        // Тип обещает `writeFile`, но провайдер приходит из JS расширения.
        const writable = typeof (provider as Partial<vscode.FileSystemProvider>).writeFile === "function";
        // `!!isReadonly` — как в эталоне: и `true`, и MarkdownString с причиной.
        if (Boolean(options?.isReadonly) || !writable) {
            this.readonlySchemes.add(scheme);
        }
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
                this.readonlySchemes.delete(scheme);
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

    /** Схемы провайдеров только для чтения (подмножество {@link schemes}). */
    public readonly(): string[] {
        return [...this.readonlySchemes];
    }

    /** Записываема ли схема: `undefined` — провайдера нет. */
    public isWritable(scheme: string): boolean | undefined {
        if (!this.providers.has(scheme)) return undefined;
        return !this.readonlySchemes.has(scheme);
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
        if (uri.scheme !== "file") return await providerOf(uri).readFile(uri);
        return disk.readFile(uri);
    }

    /** Провайдер не-file схемы; без провайдера — `Unavailable`. */
    function providerOf(uri: vscode.Uri): vscode.FileSystemProvider {
        const provider = providers?.get(uri.scheme);
        if (provider === undefined) throw FileSystemError.Unavailable(uri);
        return provider;
    }

    return {
        stat: async (uri) => {
            if (uri.scheme !== "file") return await providerOf(uri).stat(uri);
            return await disk.stat(uri);
        },
        readFile,
        writeFile: async (uri, content) => {
            if (uri.scheme !== "file") {
                const provider = providerOf(uri);
                // Эталон (`ExtHostConsumerFileSystem`): запись в read-only ФС — NoPermissions.
                // Stryker disable next-line OptionalChaining: эквивалентный — без реестра `providerOf` строкой выше уже отказал `Unavailable`
                if (providers?.isWritable(uri.scheme) !== true) throw FileSystemError.NoPermissions(uri);
                await provider.writeFile(uri, content, { create: true, overwrite: true });
                return;
            }
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
        // `file` записываем всегда; схема провайдера — по его `isReadonly`;
        // незнакомая схема — `undefined` («редактор не знает такой ФС»), как в эталоне.
        isWritableFileSystem: (scheme: string): boolean | undefined =>
            scheme === "file" ? true : providers?.isWritable(scheme),
    };
}
