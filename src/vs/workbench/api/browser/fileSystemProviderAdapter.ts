import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import {
    FileOperationError,
    FileOperationResult,
    FileSystemProviderCapabilities,
    type IFileService,
    type IFileSystemProvider,
    type IStat,
    joinFileWriteContent,
} from "../../../platform/files/common/files.ts";
import type { IExtensionFileSystemBridge } from "../common/iExtensionFileSystem.ts";

/**
 * One change event for all schemes: each provider filters it by its own, otherwise an edit
 * in `git:` would wake up `output:` consumers.
 */
export class FileSystemProviderAdapter extends Disposable {
    private readonly bridge: IExtensionFileSystemBridge;
    private readonly registry: IFileService;
    private readonly registrations = new Map<
        string,
        { readonly readonly: boolean; readonly registration: IDisposable }
    >();

    public constructor(bridge: IExtensionFileSystemBridge, registry: IFileService) {
        super();
        this.bridge = bridge;
        this.registry = registry;
        this.register(
            this.bridge.onFileSystemProvidersChanged(() => {
                this.sync();
            }),
        );
        this.register({
            dispose: () => {
                this.clear();
            },
        });
        // The extension may have declared schemes before the adapter was created.
        this.sync();
    }

    /** A scheme whose writability changed is re-registered: a core provider's capabilities are immutable. */
    private sync(): void {
        const wanted = new Map(
            this.bridge.getFileSystemSchemes().map((scheme) => [scheme, this.bridge.isReadonlyFileSystem(scheme)]),
        );

        for (const [scheme, entry] of this.registrations) {
            if (wanted.get(scheme) === entry.readonly) continue;
            entry.registration.dispose();
            this.registrations.delete(scheme);
        }

        for (const [scheme, readonly] of wanted) {
            if (this.registrations.has(scheme)) continue;
            this.registrations.set(scheme, { readonly, registration: this.registerScheme(scheme, readonly) });
        }
    }

    /** The service needs `stat` only for writes: for a read-only scheme it would be an extra RPC round trip per read. */
    private registerScheme(scheme: string, readonly: boolean): IDisposable {
        const provider: IFileSystemProvider = {
            capabilities: readonly ? FileSystemProviderCapabilities.Readonly : FileSystemProviderCapabilities.None,
            readFile: (uri) => this.bridge.readProvidedFile(uri),
            onDidChangeFile: (cb) =>
                this.bridge.onDidChangeProvidedFile((uris) => {
                    const mine = uris.filter((uri: Uri) => uri.scheme === scheme);
                    if (mine.length > 0) cb(mine);
                }),
        };
        if (readonly) return this.registry.registerProvider(scheme, provider);
        return this.registry.registerProvider(scheme, {
            ...provider,
            stat: async (uri): Promise<IStat> => {
                const stat = await this.bridge.statProvidedFile(uri);
                if (stat === null) {
                    throw new FileOperationError(`'${uri.toString()}' does not exist`, FileOperationResult.NotFound);
                }
                return stat;
            },
            writeFile: async (uri, content) => this.bridge.writeProvidedFile(uri, await joinFileWriteContent(content)),
        });
    }

    private clear(): void {
        for (const entry of this.registrations.values()) entry.registration.dispose();
        this.registrations.clear();
    }
}
