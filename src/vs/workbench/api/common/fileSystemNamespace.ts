import type * as vscode from "vscode";

import { Emitter } from "../../../base/common/event.ts";

import type { IDiskFileSystem } from "./extHostDisk.ts";
import { FileSystemError } from "./vscodeTypes.ts";

/**
 * `file` — прямо на диск субпроцесса, без RPC: файл живёт на той же машине и не
 * является буфером ядра. Ошибки — {@link FileSystemError} с `code` VS Code:
 * расширения ловят их по `err.code === "FileNotFound"`.
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
 * `fsPath` не-file схемы не бросает (`untitled:Untitled-1` → `"Untitled-1"`):
 * без гейта `writeFile` создал бы `$CWD/Untitled-1` вместо ошибки (#107).
 */
function assertFileScheme(uri: vscode.Uri): void {
    if (uri.scheme !== "file") throw FileSystemError.Unavailable(uri);
}

/** Здесь, а не в `workspaceNamespace`: роутинг по схеме тестируется без RPC. */
export class SubprocessFileSystemProviders {
    private readonly providers = new Map<string, vscode.FileSystemProvider>();
    private readonly readonlySchemes = new Set<string>();
    private readonly onDidChangeSchemesEmitter = new Emitter<void>();
    private readonly onDidChangeFileEmitter = new Emitter<vscode.Uri[]>();
    private readonly changeSubscriptions = new Map<string, vscode.Disposable>();

    /**
     * Сверх эталона только для чтения и провайдер без `writeFile`: расширение на JS
     * такого собрать может, а писать в него нечем.
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
        // Для git: сдвинулся HEAD/индекс — ядро сбрасывает кэш оригиналов.
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

    public schemes(): string[] {
        return [...this.providers.keys()];
    }

    public readonly(): string[] {
        return [...this.readonlySchemes];
    }

    /** `undefined` — провайдера схемы нет. */
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
    async function readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (uri.scheme !== "file") return await providerOf(uri).readFile(uri);
        return disk.readFile(uri);
    }

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
        // Незнакомая схема — `undefined` («редактор не знает такой ФС»), как в эталоне.
        isWritableFileSystem: (scheme: string): boolean | undefined =>
            scheme === "file" ? true : providers?.isWritable(scheme),
    };
}
