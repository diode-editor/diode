// Типы для импорта `e2e-artifacts.mjs` из TypeScript (e2e/globalSetup.ts,
// e2e/helpers/buildOnce.ts). Нужны typecheck'у: `tools/` входит в tsconfig и тянет
// e2e/helpers, а без объявления импорт `.mjs` — неявный `any` (TS7016).
// Объявлено только то, что импортирует TS; источник правды — JSDoc в самом .mjs.

export interface E2eArtifacts {
    /** Ключ сборки (хеш исходников) или `null`, если дерево не git и кэшировать нечем. */
    key: string | null;
    dir: string;
    binary: string;
    /** Self-extract — POSIX sh-стаб; под Windows его нет. */
    selfExtract: string | undefined;
    /** Сборка взята из кэша, а не собрана этим вызовом. */
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
