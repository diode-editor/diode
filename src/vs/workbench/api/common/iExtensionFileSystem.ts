import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import type { IStat } from "../../../platform/files/common/files.ts";

/** Обратный порт — что Workbench'у нужно от host'а: реализует сам `ExtensionHost`, структурно. */
export interface IExtensionFileSystemBridge {
    getFileSystemSchemes(): readonly string[];
    onFileSystemProvidersChanged(cb: () => void): IDisposable;
    /** `isReadonly` или провайдер без `writeFile`. */
    isReadonlyFileSystem(scheme: string): boolean;
    /** Отклоняется, если host не поднят или схемы нет. */
    readProvidedFile(uri: Uri): Promise<Uint8Array>;
    /** `null` — ресурса нет. */
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
