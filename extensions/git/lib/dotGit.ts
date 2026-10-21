import * as path from "node:path";

/**
 * Не `<root>/.git`: в linked worktree и подмодуле `.git` — файл-указатель, каталог
 * лежит в `<main>/.git/worktrees/<name>`, а `refs`/`packed-refs`/`config` — в `commonPath`.
 */
export interface IDotGit {
    /** `.git` **этого** рабочего дерева: `HEAD`, `index`, `MERGE_HEAD`, … */
    readonly path: string;
    /** `undefined` — совпадает с {@link path}. */
    readonly commonPath: string | undefined;
}

/** `git rev-parse --git-dir --git-common-dir`; пути относительно `cwd` вызова. */
export function parseDotGit(stdout: string, cwd: string): IDotGit | null {
    const lines = stdout.split("\n").map((line) => line.trim());
    const rawDir = lines.at(0);
    const rawCommon = lines.at(1);
    if (rawDir === undefined || rawDir === "") return null;
    const dir = absolute(rawDir, cwd);
    // `--git-common-dir` — с git 2.5; на старом второй строки нет.
    const common = rawCommon === undefined || rawCommon === "" ? dir : absolute(rawCommon, cwd);
    return { path: dir, commonPath: common === dir ? undefined : common };
}

function absolute(candidate: string, cwd: string): string {
    return path.normalize(path.isAbsolute(candidate) ? candidate : path.join(cwd, candidate));
}

export function refsRoot(dotGit: IDotGit): string {
    return dotGit.commonPath ?? dotGit.path;
}

/** Упакованного ref'а (`packed-refs`) по этому пути нет — его заметно по изменению `packed-refs`. */
export function upstreamRefPath(dotGit: IDotGit, upstream: string | null): string | null {
    if (upstream === null || upstream === "") return null;
    const segments = upstream.split("/").filter((segment) => segment !== "");
    if (segments.length < 2) return null;
    return path.join(refsRoot(dotGit), "refs", "remotes", ...segments);
}
