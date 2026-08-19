import * as path from "node:path";

/**
 * Служебный каталог репозитория. У обычного клона это `<root>/.git`, но
 * рассчитывать на это нельзя: в **linked worktree** и в подмодуле `.git` —
 * файл-указатель, а настоящий каталог лежит в другом месте
 * (`<main>/.git/worktrees/<name>`), причём часть содержимого (`refs`,
 * `packed-refs`, `config`) общая и живёт в `commonPath`.
 *
 * Это не экзотика: в worktree ведётся вся работа по фиче, и watcher, который
 * ищет `<root>/.git` каталогом, там просто не заводится.
 */
export interface IDotGit {
    /** Каталог `.git` **этого** рабочего дерева: `HEAD`, `index`, `MERGE_HEAD`, … */
    readonly path: string;
    /** Общий каталог (`refs`, `packed-refs`), если он отличается от {@link path}. */
    readonly commonPath: string | undefined;
}

/**
 * Разбирает вывод `git rev-parse --git-dir --git-common-dir` (две строки,
 * пути могут быть относительными — git отдаёт их относительно cwd вызова).
 * `null` — вывод структурно чужой (git недоступен, не репозиторий).
 */
export function parseDotGit(stdout: string, cwd: string): IDotGit | null {
    const [rawDir, rawCommon] = stdout.split("\n").map((line) => line.trim());
    if (rawDir === undefined || rawDir === "") return null;
    const dir = absolute(rawDir, cwd);
    // `--git-common-dir` появился в git 2.5; на более старом git второй строки
    // не будет — считаем, что общий каталог совпадает с обычным.
    const common = rawCommon === undefined || rawCommon === "" ? dir : absolute(rawCommon, cwd);
    return { path: dir, commonPath: common === dir ? undefined : common };
}

function absolute(candidate: string, cwd: string): string {
    return path.normalize(path.isAbsolute(candidate) ? candidate : path.join(cwd, candidate));
}

/** Каталог, где лежат общие `refs`/`packed-refs`: у обычного клона это сам `.git`. */
export function refsRoot(dotGit: IDotGit): string {
    return dotGit.commonPath ?? dotGit.path;
}

/**
 * Путь ref'а upstream'а текущей ветки (`origin/main` → `<refs>/refs/remotes/origin/main`).
 * `null` — upstream не задан или имя пустое.
 *
 * Ref может быть **упакован** (`packed-refs`) — тогда файла по этому пути нет,
 * и watcher за ним не заведётся; upstream в таком репозитории заметен по
 * изменению самого `packed-refs` в общем каталоге.
 */
export function upstreamRefPath(dotGit: IDotGit, upstream: string | null): string | null {
    if (upstream === null || upstream === "") return null;
    const segments = upstream.split("/").filter((segment) => segment !== "");
    if (segments.length < 2) return null;
    return path.join(refsRoot(dotGit), "refs", "remotes", ...segments);
}
