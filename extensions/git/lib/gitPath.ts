import * as fs from "node:fs";

/**
 * Upstream `findGit`: `git.path` is a path or a list of paths to look up, the first existing one wins; none (the
 * default `null`) — git from PATH.
 */
export function configuredGitPath(
    value: unknown,
    exists: (path: string) => boolean = fs.existsSync,
): string | undefined {
    const candidates = (Array.isArray(value) ? value : [value]).filter(
        (candidate): candidate is string => typeof candidate === "string" && candidate !== "",
    );
    return candidates.find((candidate) => exists(candidate));
}
