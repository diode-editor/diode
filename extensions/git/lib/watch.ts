import * as path from "node:path";

/**
 * Фильтры файловых событий для git-расширения — дословно правила VS Code
 * (`extensions/git/src/repository.ts`), потому что в них зашит опыт, который
 * иначе набивается граблями:
 *
 * - `index.lock` **обязан** игнорироваться: он создаётся и удаляется на каждой
 *   git-операции, и рефреш по нему — это шторм статусов ровно в тот момент,
 *   когда репозиторий занят (и когда `git status` за этот же лок и подерётся);
 * - cookie-файлы watchman'а (`.watchman-cookie-*`) — тот же мусор, только от
 *   fsmonitor-хука;
 * - всё **остальное** в первом уровне `.git` рефреш вызывает: `HEAD` (checkout),
 *   `index` (stage), `MERGE_HEAD`/`rebase-merge` (состояние операции), `refs`
 *   (коммит). Фильтр по белому списку имён пропускал бы половину из этого.
 */

/** Событие в `.git`, на которое НЕ надо реагировать. */
const IGNORED_DOT_GIT = /\/\.git(\/index\.lock|\/worktrees\/[^/]+\/index\.lock)?$|\/\.watchman-cookie-/;

/** Путь внутри рабочего дерева, ведущий в `.git` (событие служебного каталога). */
const UNDER_DOT_GIT = /(^|[\\/])\.git([\\/]|$)/;

/** Стоит ли будить refresh по событию в служебном каталоге. */
export function isRelevantDotGitEvent(fsPath: string): boolean {
    return !IGNORED_DOT_GIT.test(toPosix(fsPath));
}

/**
 * Стоит ли будить refresh по событию в рабочем дереве. `.git` отсекаем: за ним
 * следит отдельный, более дешёвый watcher со своим фильтром.
 */
export function isRelevantWorkingTreeEvent(repoRoot: string, fsPath: string): boolean {
    const relative = path.relative(repoRoot, fsPath);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
    return !UNDER_DOT_GIT.test(relative);
}

function toPosix(fsPath: string): string {
    return fsPath.split(path.sep).join("/");
}
