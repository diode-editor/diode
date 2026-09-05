import type { IExtensionRegistrySource } from "../common/iExtensionRegistrySource.ts";
import { FileExtensionRegistrySource } from "./fileRegistrySource.ts";
import { HttpExtensionRegistrySource } from "./httpRegistrySource.ts";

/**
 * Выбор источника реестра по значению `--registry`: адрес — HTTP, всё прочее —
 * каталог. Одно место, где решается, куда клиент идёт за расширениями.
 */

/** Публичный курируемый реестр Diode — дефолт, когда `--registry` не передан. */
export const DEFAULT_REGISTRY_URL = "https://diode-editor.github.io/registry/v1/";

/**
 * Различаем строго по префиксу схемы, а не разбором `new URL`: виндовый путь
 * `C:\registry` разбирается как URL с протоколом `c:` и ушёл бы в HTTP-ветку.
 */
function isHttpUrl(spec: string): boolean {
    const lower = spec.toLowerCase();
    return lower.startsWith("http://") || lower.startsWith("https://");
}

/**
 * `spec` — значение `--registry` (каталог или http(s)-адрес) либо `undefined`,
 * тогда берётся {@link DEFAULT_REGISTRY_URL}. `onProblem` получает диагностики
 * пропущенных записей реестра.
 */
export function createRegistrySource(
    spec: string | undefined,
    onProblem?: (message: string) => void,
): IExtensionRegistrySource {
    const target = spec ?? DEFAULT_REGISTRY_URL;
    return isHttpUrl(target)
        ? new HttpExtensionRegistrySource(target, onProblem)
        : new FileExtensionRegistrySource(target, onProblem);
}
