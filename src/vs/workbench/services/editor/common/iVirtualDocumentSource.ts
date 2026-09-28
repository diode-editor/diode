import type { Uri } from "../../../../base/common/uri.ts";

/**
 * Источник содержимого **недисковых** ресурсов: всё, что адресуется не схемой
 * `file:` и чей текст даёт не файловая система, а кто-то снаружи ядра — прежде
 * всего провайдеры расширений (`workspace.registerTextDocumentContentProvider`:
 * `jdt:` и `class:` у `redhat.java`, исходники из JDK и декомпиляция).
 *
 * Шов ровно такой же, как у
 * {@link import("../../../../editor/common/languages/iDefinitionSource.ts").DefinitionSource}
 * и соседей: тип живёт в ядре, а подключает к нему extension host композиция
 * (`extensionHostModule`). Ядро про host не знает.
 *
 * Документы таких ресурсов **read-only** по построению: диска за ними нет,
 * записывать некуда — это ровно контракт `TextDocumentContentProvider`
 * («allows to add readonly documents to the editor»).
 */
export interface IVirtualDocumentSource {
    /** Есть ли поставщик содержимого для схемы. */
    canProvide(scheme: string): boolean;

    /**
     * Содержимое ресурса. `null` — поставщик схемы есть, но этот ресурс он
     * отдать не смог (вернул `undefined`/`null`, как разрешает `ProviderResult`).
     * Отклонение — поставщик сломался; вызывающий обязан это пережить.
     */
    provide(uri: Uri): Promise<string | null>;
}

/**
 * Источник-пустышка: схем не обслуживает, содержимого не даёт. Дефолт
 * `EditorService`, пока композиция не подключила настоящий (тесты, профили без
 * extension host). Null-объект, а не `undefined`, по той же причине, что
 * {@link import("../../../../platform/log/common/nullLogService.ts").NULL_LOGGER}:
 * у потребителя не заводится ветка «источника нет», которую нечем проверить.
 */
export const NULL_VIRTUAL_DOCUMENT_SOURCE: IVirtualDocumentSource = {
    canProvide: () => false,
    provide: () => Promise.resolve(null),
};
