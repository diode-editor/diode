import * as path from "node:path";

import type { IRunGitOptions } from "./runGit.ts";
import { runGit } from "./runGit.ts";

/** The file is absent at this revision (untracked, new, deleted): a normal outcome, not "git is broken". */
export class GitRevisionNotFoundError extends Error {
    public constructor(revisionPath: string, ref: string) {
        super(`file "${revisionPath}" is not in revision "${ref}"`);
        Object.setPrototypeOf(this, GitRevisionNotFoundError.prototype);
    }
}

/** `git show` understands neither absolute paths nor backslashes; `null` for a file outside the repo. */
export function toRepoRelativePath(repoRoot: string, absolutePath: string): string | null {
    const relative = path.relative(repoRoot, absolutePath);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join("/");
}

/** No revision and no git are one error: either way the gutter has nothing to show. */
export async function showFileAtRevision(
    repoRoot: string,
    absolutePath: string,
    ref: string,
    env?: NodeJS.ProcessEnv,
): Promise<Uint8Array> {
    const relative = toRepoRelativePath(repoRoot, absolutePath);
    if (relative === null) throw new GitRevisionNotFoundError(absolutePath, ref);

    const opts: IRunGitOptions = { cwd: repoRoot };
    if (env !== undefined) opts.env = env;
    const result = await runGit(["show", `${ref}:${relative}`], opts);

    if ("error" in result || result.code !== 0) throw new GitRevisionNotFoundError(relative, ref);
    return new TextEncoder().encode(result.stdout);
}
