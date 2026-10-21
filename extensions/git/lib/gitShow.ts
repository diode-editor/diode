import * as path from "node:path";

import type { IRunGitOptions } from "./runGit.ts";
import { runGit } from "./runGit.ts";

/** Файла нет в этой ревизии (untracked, новый, удалён) — штатный исход, а не «git сломался». */
export class GitRevisionNotFoundError extends Error {
    public constructor(revisionPath: string, ref: string) {
        super(`file "${revisionPath}" is not in revision "${ref}"`);
        Object.setPrototypeOf(this, GitRevisionNotFoundError.prototype);
    }
}

/** `git show` не понимает ни абсолютных путей, ни обратных слэшей; `null` — файл вне репо. */
export function toRepoRelativePath(repoRoot: string, absolutePath: string): string | null {
    const relative = path.relative(repoRoot, absolutePath);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join("/");
}

/** Нет версии и нет git — одна ошибка: гуттеру в обоих случаях нечего показывать. */
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
