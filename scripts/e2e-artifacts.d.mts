// Без объявления импорт `.mjs` из TS — неявный `any` (TS7016). Объявлено только то,
// что импортирует TS; источник правды — JSDoc в самом .mjs.

export interface E2eArtifacts {
    /** `null`, если дерево не git и кэшировать нечем. */
    key: string | null;
    dir: string;
    binary: string;
    /** Под Windows sh-стаба нет. */
    selfExtract: string | undefined;
    hit: boolean;
    /** Снимает метку «сборка используется». */
    release: () => void;
}

export function ensureE2eArtifacts(params: {
    repoRoot: string;
    root?: string;
    keep?: number;
    log?: (msg: string) => void;
}): E2eArtifacts;
