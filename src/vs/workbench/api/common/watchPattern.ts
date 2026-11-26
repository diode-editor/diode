/**
 * VS Code rule: a single-segment pattern watches only direct children of the base,
 * `**` or a separator watches the subtree. The cheap `.git` watcher relies on this:
 * `new RelativePattern(dotGit, "*")` doesn't drag `.git/objects` along.
 *
 * A module of its own: the core's disk watcher and the extension host's provider watcher both need it,
 * and `fileWatcherNamespace.ts` pulls `vscodeTypes` (a lazy chunk) into whoever imports it.
 */
export function isRecursiveWatchPattern(pattern: string): boolean {
    return pattern.includes("**") || pattern.includes("/");
}
