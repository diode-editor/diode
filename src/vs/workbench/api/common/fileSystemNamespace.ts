import type * as vscode from "vscode";

import { Emitter } from "../../../base/common/event.ts";

import type { IDiskFileSystem } from "./extHostDisk.ts";
import { FileSystemError } from "./vscodeTypes.ts";

/**
 * `file` goes straight to the subprocess disk, no RPC: the file lives on the same machine and
 * isn't a core buffer. Errors are {@link FileSystemError} with a VS Code `code`:
 * extensions catch them by `err.code === "FileNotFound"`.
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
 * `fsPath` of a non-file scheme doesn't throw (`untitled:Untitled-1` → `"Untitled-1"`):
 * without the gate `writeFile` would create `$CWD/Untitled-1` instead of failing (#107).
 */
function assertFileScheme(uri: vscode.Uri): void {
    if (uri.scheme !== "file") throw FileSystemError.Unavailable(uri);
}

/** Here rather than in `workspaceNamespace`: scheme routing is tested without RPC. */
export class SubprocessFileSystemProviders {
    private readonly providers = new Map<string, vscode.FileSystemProvider>();
    private readonly readonlySchemes = new Set<string>();
    private readonly onDidChangeSchemesEmitter = new Emitter<void>();
    private readonly onDidChangeFileEmitter = new Emitter<vscode.Uri[]>();
    private readonly changeSubscriptions = new Map<string, vscode.Disposable>();

    /**
     * Beyond upstream, a provider without `writeFile` is also read-only: a JS extension
     * can build one, and there is no way to write to it.
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
        // The type promises `writeFile`, but the provider comes from the extension's JS.
        const writable = typeof (provider as Partial<vscode.FileSystemProvider>).writeFile === "function";
        // `!!isReadonly` as upstream: both `true` and a MarkdownString with a reason.
        if (Boolean(options?.isReadonly) || !writable) {
            this.readonlySchemes.add(scheme);
        }
        // For git: HEAD/index moved, so the core resets its originals cache.
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

    /** `undefined`: no provider for the scheme. */
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
                // Upstream (`ExtHostConsumerFileSystem`): writing to a read-only FS is NoPermissions.
                // Stryker disable next-line OptionalChaining: equivalent — without a registry `providerOf` on the line above has already refused with `Unavailable`
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
        // Unknown scheme: `undefined` ("the editor doesn't know such an FS"), as upstream.
        isWritableFileSystem: (scheme: string): boolean | undefined =>
            scheme === "file" ? true : providers?.isWritable(scheme),
    };
}
