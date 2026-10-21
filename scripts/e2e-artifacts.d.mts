// Without a declaration, importing `.mjs` from TS is an implicit `any` (TS7016). Declares only what
// TS imports; the JSDoc in the .mjs itself is the source of truth.

export interface E2eArtifacts {
    /** `null` when the tree is not a git checkout and there is nothing to key the cache on. */
    key: string | null;
    dir: string;
    binary: string;
    /** No sh stub on Windows. */
    selfExtract: string | undefined;
    hit: boolean;
    /** Removes the "build in use" mark. */
    release: () => void;
}

export function ensureE2eArtifacts(params: {
    repoRoot: string;
    root?: string;
    keep?: number;
    log?: (msg: string) => void;
}): E2eArtifacts;
