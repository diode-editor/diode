/**
 * Как `extensions/git/src/uri.ts` upstream: `git:/repo/a.ts?{"path":"/repo/a.ts","ref":"HEAD"}`.
 * Путь дублируется в query намеренно: на Windows `uri.path` несёт ведущий слэш
 * (`/C:/repo/a.ts`), а в query лежит ровно `fsPath`.
 */

export interface IGitUriParams {
    /** `fsPath` исходного ресурса. */
    path: string;
    /** `HEAD`, `` (индекс), sha, имя ветки. */
    ref: string;
}

export const GIT_SCHEME = "git";

export function toGitUri(
    uri: { path: string; fsPath: string },
    ref: string,
): { scheme: string; path: string; query: string } {
    const params: IGitUriParams = { path: uri.fsPath, ref };
    return { scheme: GIT_SCHEME, path: uri.path, query: JSON.stringify(params) };
}

/** `null` — чужой ресурс или query: провайдер отвечает «файла нет», а не читает мусор. */
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
 * Аналог `QuickDiffProvider.provideOriginalResource`. Id дублируется в ядре
 * (`contrib/scm/browser/commandOriginalResourceProvider.ts`); временный
 * контракт до `scm`-неймспейса — docs/TODO/Diff.md, «Долг».
 */
export const ORIGINAL_RESOURCE_COMMAND = "diode.scm.originalResource";
