import type { Uri } from "../../../../base/common/uri.ts";

/**
 * Недисковые ресурсы, чей текст даёт провайдер расширения
 * (`registerTextDocumentContentProvider`: `jdt:` у `redhat.java`). Read-only по
 * построению — контракт `TextDocumentContentProvider`.
 */
export interface IVirtualDocumentSource {
    canProvide(scheme: string): boolean;

    /**
     * `null` — поставщик схемы есть, но ресурс не отдал (`ProviderResult`). Отклонение —
     * поставщик сломался; вызывающий обязан это пережить.
     */
    provide(uri: Uri): Promise<string | null>;
}

/** Дефолт `EditorService`, пока композиция не подключила настоящий. */
export const NULL_VIRTUAL_DOCUMENT_SOURCE: IVirtualDocumentSource = {
    canProvide: () => false,
    provide: () => Promise.resolve(null),
};
