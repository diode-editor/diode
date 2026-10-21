import * as path from "node:path";

/**
 * Not `<root>/.git`: in a linked worktree or submodule `.git` is a pointer file, the directory
 * lives in `<main>/.git/worktrees/<name>`, and `refs`/`packed-refs`/`config` live in `commonPath`.
 */
export interface IDotGit {
    /** `.git` of **this** working tree: `HEAD`, `index`, `MERGE_HEAD`, … */
    readonly path: string;
    /** `undefined` when equal to {@link path}. */
    readonly commonPath: string | undefined;
}

/** `git rev-parse --git-dir --git-common-dir`; paths are relative to the call's `cwd`. */
export function parseDotGit(stdout: string, cwd: string): IDotGit | null {
    const lines = stdout.split("\n").map((line) => line.trim());
    const rawDir = lines.at(0);
    const rawCommon = lines.at(1);
    if (rawDir === undefined || rawDir === "") return null;
    const dir = absolute(rawDir, cwd);
    // `--git-common-dir` exists since git 2.5; older git prints no second line.
    const common = rawCommon === undefined || rawCommon === "" ? dir : absolute(rawCommon, cwd);
    return { path: dir, commonPath: common === dir ? undefined : common };
}

function absolute(candidate: string, cwd: string): string {
    return path.normalize(path.isAbsolute(candidate) ? candidate : path.join(cwd, candidate));
}

export function refsRoot(dotGit: IDotGit): string {
    return dotGit.commonPath ?? dotGit.path;
}

/** A packed ref (`packed-refs`) has no file at this path; it shows up as a change of `packed-refs`. */
export function upstreamRefPath(dotGit: IDotGit, upstream: string | null): string | null {
    if (upstream === null || upstream === "") return null;
    const segments = upstream.split("/").filter((segment) => segment !== "");
    if (segments.length < 2) return null;
    return path.join(refsRoot(dotGit), "refs", "remotes", ...segments);
}
