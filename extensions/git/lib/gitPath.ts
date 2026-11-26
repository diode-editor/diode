import * as fs from "node:fs";

/**
 * Upstream `findGit`: `git.path` is a path or a list of paths to look up, the first existing one wins; none (the
 * default `null`) — git from PATH. `existsSync` is false for `""` and for a non-path (`null`, a number) and never
 * throws, so it is the whole check.
 */
export function configuredGitPath(value: unknown): string | undefined {
    const candidates: unknown[] = Array.isArray(value) ? value : [value];
    return candidates.find((candidate): candidate is string => fs.existsSync(candidate as string));
}
