import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import type { IStat } from "../../../platform/files/common/files.ts";

/** Reverse port (what the workbench needs from the host): `ExtensionHost` implements it structurally. */
export interface IExtensionFileSystemBridge {
    getFileSystemSchemes(): readonly string[];
    onFileSystemProvidersChanged(cb: () => void): IDisposable;
    /** `isReadonly` or a provider without `writeFile`. */
    isReadonlyFileSystem(scheme: string): boolean;
    /** Rejects if the host is not running or the scheme is unknown. */
    readProvidedFile(uri: Uri): Promise<Uint8Array>;
    /** `null`: the resource does not exist. */
    statProvidedFile(uri: Uri): Promise<IStat | null>;
    writeProvidedFile(uri: Uri, content: Uint8Array): Promise<void>;
    onDidChangeProvidedFile(cb: (uris: readonly Uri[]) => void): IDisposable;
}

export const NULL_EXTENSION_FILE_SYSTEM_BRIDGE: IExtensionFileSystemBridge = {
    getFileSystemSchemes: () => [],
    onFileSystemProvidersChanged: () => ({ dispose: () => undefined }),
    isReadonlyFileSystem: () => true,
    readProvidedFile: () => Promise.reject(new Error("extension host is not running")),
    statProvidedFile: () => Promise.reject(new Error("extension host is not running")),
    writeProvidedFile: () => Promise.reject(new Error("extension host is not running")),
    onDidChangeProvidedFile: () => ({ dispose: () => undefined }),
};
