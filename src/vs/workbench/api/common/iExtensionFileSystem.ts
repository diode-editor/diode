import type { IDisposable } from "@tuidom/core/common/disposable";
import type { Uri } from "../../../base/common/uri.ts";

/**
 * Тонкий «port» поверх {@link ExtensionHost}, нужный ядру, чтобы читать
 * недисковые ресурсы через провайдеров расширений, не зная про host-мост.
 *
 * Направление обратное привычному: обычно порты в этом каталоге описывают, что
 * host'у нужно от Workbench ({@link IEditorDecorationsService},
 * {@link ICommandService}), а здесь — что Workbench'у нужно от host'а. Поэтому
 * реализует его сам `ExtensionHost` (структурно), а связывает с
 * `IFileSystemProviderRegistry` адаптер в `api/browser`.
 */
export interface IExtensionFileSystemBridge {
    /** Схемы, для которых расширения зарегистрировали провайдеров. */
    getFileSystemSchemes(): readonly string[];
    /** Набор схем изменился (расширение активировалось/сняло провайдера). */
    onFileSystemProvidersChanged(cb: () => void): IDisposable;
    /** Читает ресурс провайдером его схемы. Отклоняется, если host не поднят или схемы нет. */
    readProvidedFile(uri: Uri): Promise<Uint8Array>;
    /** Содержимое ресурсов провайдера изменилось снаружи. */
    onDidChangeProvidedFile(cb: (uris: readonly Uri[]) => void): IDisposable;
}

/** No-op мост — для тестов/профилей без extension host. */
export const NULL_EXTENSION_FILE_SYSTEM_BRIDGE: IExtensionFileSystemBridge = {
    getFileSystemSchemes: () => [],
    onFileSystemProvidersChanged: () => ({ dispose: () => undefined }),
    readProvidedFile: () => Promise.reject(new Error("extension host is not running")),
    onDidChangeProvidedFile: () => ({ dispose: () => undefined }),
};
