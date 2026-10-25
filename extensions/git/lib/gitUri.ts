/**
 * Like upstream `extensions/git/src/uri.ts`: `git:/repo/a.ts?{"path":"/repo/a.ts","ref":"HEAD"}`.
 * The path is duplicated in the query on purpose: on Windows `uri.path` carries a leading slash
 * (`/C:/repo/a.ts`), while the query holds exactly `fsPath`.
 */

export interface IGitUriParams {
    /** `fsPath` of the original resource. */
    path: string;
    /** `HEAD`, `` (index), sha, branch name. */
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

/** `null` for a foreign resource or query: the provider answers "no file" instead of reading garbage. */
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
 * The index as a {@link ORIGINAL_RESOURCE_COMMAND} ref, like upstream's `~` (`getLeftResource` in
 * `extensions/git/src/repository.ts`); the git uri stores it as `` (`git show :path`).
 */
export const INDEX_REF = "~";

/** The ref a git uri stores for a command argument: none or empty is HEAD. */
export function gitRefOf(rawRef: unknown): string {
    if (rawRef === INDEX_REF) return "";
    return typeof rawRef === "string" && rawRef !== "" ? rawRef : "HEAD";
}

/**
 * Counterpart of `QuickDiffProvider.provideOriginalResource`. The id is duplicated in the core
 * (`contrib/scm/browser/commandOriginalResourceProvider.ts`); a temporary
 * contract until the `scm` namespace, see docs/TODO/Diff.md#долг.
 */
export const ORIGINAL_RESOURCE_COMMAND = "diode.scm.originalResource";
