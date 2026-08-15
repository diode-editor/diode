import type { IDisposable } from "@tuidom/core/common/disposable";
import type { Uri } from "../../../base/common/uri.ts";

/**
 * Read-only поставщик содержимого для одной схемы URI (`git:`, в будущем
 * `output:`, `untitled:`…). Срез vscode-шного `FileSystemProvider` до того
 * минимума, который нужен ядру: прочитать ресурс и узнать, что он изменился.
 *
 * Запись/удаление/обход каталога сюда не входят намеренно — первый потребитель
 * (дифф против версии из `HEAD`) их не требует, а неиспользуемая поверхность
 * порта стоила бы реализации в каждом адаптере. Появится потребитель — вырастет
 * и порт; в `vscode.d.ts` соответствующие члены `FileSystemProvider` пока не
 * раскомментированы (bounded member-level uncommenting, см. AGENTS.md).
 */
export interface IReadOnlyFileSystemProvider {
    /** Содержимое ресурса. Бросает, если ресурса нет (семантика `FileSystemError.FileNotFound`). */
    readFile(uri: Uri): Promise<Uint8Array>;
    /** Ресурсы этой схемы изменились снаружи (для `git:` — сдвинулся HEAD/индекс). */
    onDidChangeFile(cb: (uris: readonly Uri[]) => void): IDisposable;
}

/**
 * Реестр поставщиков содержимого по схеме URI — ядро адресации недисковых
 * ресурсов (аналог `IFileService` + `registerProvider` у vscode; шаг 2 из #107,
 * см. [docs/TODO/Uri.md]).
 *
 * Схему `file` обслуживает read-only `DiskFileSystemProvider` (node-слой,
 * регистрируется композицией) — для browser-потребителей, которым нужен снимок
 * с диска без открытого редактора (прямой дифф из Changes). Горячий путь
 * открытия файла (`TextFileModel`) по-прежнему читает диск напрямую, мимо
 * реестра.
 */
export interface IFileSystemProviderRegistry {
    /**
     * Регистрирует поставщика для схемы. Повторная регистрация занятой схемы —
     * ошибка (как в VS Code: «There can only be one provider per scheme»).
     */
    registerProvider(scheme: string, provider: IReadOnlyFileSystemProvider): IDisposable;

    /** Есть ли поставщик для схемы. Позволяет потребителю не ловить исключение в штатной ситуации. */
    hasProvider(scheme: string): boolean;

    /** Читает ресурс поставщиком его схемы. Бросает, если поставщика нет. */
    readFile(uri: Uri): Promise<Uint8Array>;

    /** Агрегированное «содержимое изменилось» по всем зарегистрированным схемам. */
    onDidChangeFile(cb: (uris: readonly Uri[]) => void): IDisposable;

    /**
     * Набор поставщиков изменился. Ключевое для потребителей: расширение,
     * поставляющее схему, активируется АСИНХРОННО и обычно уже после того, как
     * открылся первый файл. Без этого события потребитель, однажды получивший
     * «поставщика нет», так и остался бы с этим ответом.
     */
    onDidChangeProviders(cb: () => void): IDisposable;
}

/** No-op реестр: поставщиков нет (тесты, профили без extension host). */
export const NULL_FILE_SYSTEM_PROVIDER_REGISTRY: IFileSystemProviderRegistry = {
    registerProvider: () => ({ dispose: () => undefined }),
    hasProvider: () => false,
    readFile: (uri) => Promise.reject(new Error(`no file system provider for scheme "${uri.scheme}"`)),
    onDidChangeFile: () => ({ dispose: () => undefined }),
    onDidChangeProviders: () => ({ dispose: () => undefined }),
};
