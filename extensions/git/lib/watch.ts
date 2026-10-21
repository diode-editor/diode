import * as path from "node:path";

/**
 * Дословно правила VS Code (`extensions/git/src/repository.ts`). `index.lock`
 * **обязан** игнорироваться: рефреш по нему — шторм статусов ровно когда репозиторий
 * занят. Остальное в `.git` рефреш вызывает — белый список имён пропускал бы половину.
 */
const IGNORED_DOT_GIT = /\/\.git(\/index\.lock|\/worktrees\/[^/]+\/index\.lock)?$|\/\.watchman-cookie-/;

const UNDER_DOT_GIT = /(^|[\\/])\.git([\\/]|$)/;

export function isRelevantDotGitEvent(fsPath: string): boolean {
    return !IGNORED_DOT_GIT.test(toPosix(fsPath));
}

/** `.git` отсекаем: за ним следит отдельный watcher со своим фильтром. */
export function isRelevantWorkingTreeEvent(repoRoot: string, fsPath: string): boolean {
    const relative = path.relative(repoRoot, fsPath);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
    return !UNDER_DOT_GIT.test(relative);
}

function toPosix(fsPath: string): string {
    return fsPath.split(path.sep).join("/");
}
