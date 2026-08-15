/**
 * Адресация версий файла в git через схему `git:` — так же, как в VS Code
 * (`extensions/git/src/uri.ts` upstream).
 *
 * Ресурс на диске `file:///repo/src/a.ts` в версии `HEAD` адресуется как
 * `git:/repo/src/a.ts?{"path":"/repo/src/a.ts","ref":"HEAD"}`. Путь дублируется
 * в query намеренно: на Windows `uri.path` несёт ведущий слэш
 * (`/C:/repo/a.ts`), и восстанавливать из него настоящий путь на диске —
 * источник ошибок; в query кладём ровно `fsPath`.
 */

/** Разобранные параметры `git:`-ресурса. */
export interface IGitUriParams {
    /** Абсолютный путь файла на диске (`fsPath` исходного ресурса). */
    path: string;
    /** Ревизия: `HEAD`, `` (индекс), sha, имя ветки. */
    ref: string;
}

/** Схема, под которой расширение регистрирует провайдера версий. */
export const GIT_SCHEME = "git";

/**
 * Собирает `git:`-URI для версии `ref` файла. Принимает минимальный срез
 * `vscode.Uri`, чтобы модуль оставался тестируемым без рантайма расширений.
 */
export function toGitUri(
    uri: { path: string; fsPath: string },
    ref: string,
): { scheme: string; path: string; query: string } {
    const params: IGitUriParams = { path: uri.fsPath, ref };
    return { scheme: GIT_SCHEME, path: uri.path, query: JSON.stringify(params) };
}

/**
 * Разбирает `git:`-URI обратно в путь и ревизию. Возвращает `null`, если это не
 * наш ресурс или query структурно чужой, — провайдер в этом случае честно
 * отвечает «файла нет», а не читает мусор.
 */
export function fromGitUri(uri: { scheme: string; query: string }): IGitUriParams | null {
    if (uri.scheme !== GIT_SCHEME) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(uri.query) as unknown;
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const { path, ref } = parsed as { path?: unknown; ref?: unknown };
    if (typeof path !== "string" || path === "" || typeof ref !== "string") return null;
    return { path, ref };
}

/**
 * Команда, которой ядро спрашивает ресурс оригинала (аналог
 * `QuickDiffProvider.provideOriginalResource`). Идентификатор дублируется в
 * ядре (`contrib/scm/browser/commandOriginalResourceProvider.ts`) — это
 * контракт между расширением и ядром, и он временный: канонический путь —
 * `scm`-неймспейс, см. docs/TODO/Diff.md.
 */
export const ORIGINAL_RESOURCE_COMMAND = "diode.scm.originalResource";
