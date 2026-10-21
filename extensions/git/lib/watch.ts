import * as path from "node:path";

/**
 * VS Code rules verbatim (`extensions/git/src/repository.ts`). `index.lock`
 * **must** be ignored: refreshing on it is a status storm exactly when the repository
 * is busy. Everything else in `.git` triggers a refresh: a name allowlist would miss half.
 */
const IGNORED_DOT_GIT = /\/\.git(\/index\.lock|\/worktrees\/[^/]+\/index\.lock)?$|\/\.watchman-cookie-/;

const UNDER_DOT_GIT = /(^|[\\/])\.git([\\/]|$)/;

export function isRelevantDotGitEvent(fsPath: string): boolean {
    return !IGNORED_DOT_GIT.test(toPosix(fsPath));
}

/** `.git` is excluded: a separate watcher with its own filter covers it. */
export function isRelevantWorkingTreeEvent(repoRoot: string, fsPath: string): boolean {
    const relative = path.relative(repoRoot, fsPath);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
    return !UNDER_DOT_GIT.test(relative);
}

function toPosix(fsPath: string): string {
    return fsPath.split(path.sep).join("/");
}
