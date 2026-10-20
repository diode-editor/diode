import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import type { IStat } from "../../../platform/files/common/files.ts";

/**
 * Тонкий «port» поверх {@link ExtensionHost}, нужный ядру, чтобы читать
 * недисковые ресурсы через провайдеров расширений, не зная про host-мост.
 *
 * Направление обратное привычному: обычно порты в этом каталоге описывают, что
 * host'у нужно от Workbench ({@link IEditorDecorationsService},
 * {@link ICommandService}), а здесь — что Workbench'у нужно от host'а. Поэтому
 * реализует его сам `ExtensionHost` (структурно), а связывает с
 * `IFileService` адаптер в `api/browser`.
 */
export interface IExtensionFileSystemBridge {
    /** Схемы, для которых расширения зарегистрировали провайдеров. */
    getFileSystemSchemes(): readonly string[];
    /** Набор схем изменился (расширение активировалось/сняло провайдера). */
    onFileSystemProvidersChanged(cb: () => void): IDisposable;
    /** Схема провайдера только для чтения (`isReadonly` или провайдер без `writeFile`). */
    isReadonlyFileSystem(scheme: string): boolean;
    /** Читает ресурс провайдером его схемы. Отклоняется, если host не поднят или схемы нет. */
    readProvidedFile(uri: Uri): Promise<Uint8Array>;
    /** Метаданные ресурса; `null` — ресурса нет. Отклоняется, как {@link readProvidedFile}. */
    statProvidedFile(uri: Uri): Promise<IStat | null>;
    /** Пишет ресурс провайдером его схемы (создать или перезаписать). Отклоняется, как {@link readProvidedFile}. */
    writeProvidedFile(uri: Uri, content: Uint8Array): Promise<void>;
    /** Содержимое ресурсов провайдера изменилось снаружи. */
    onDidChangeProvidedFile(cb: (uris: readonly Uri[]) => void): IDisposable;
}

/** No-op мост — для тестов/профилей без extension host. */
export const NULL_EXTENSION_FILE_SYSTEM_BRIDGE: IExtensionFileSystemBridge = {
    getFileSystemSchemes: () => [],
    onFileSystemProvidersChanged: () => ({ dispose: () => undefined }),
    isReadonlyFileSystem: () => true,
    readProvidedFile: () => Promise.reject(new Error("extension host is not running")),
    statProvidedFile: () => Promise.reject(new Error("extension host is not running")),
    writeProvidedFile: () => Promise.reject(new Error("extension host is not running")),
    onDidChangeProvidedFile: () => ({ dispose: () => undefined }),
};
