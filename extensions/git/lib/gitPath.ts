import * as fs from "node:fs";

/**
 * Upstream `findGit`: `git.path` is a path or a list of paths to look up, the first existing one wins; none (the
 * default `null`) — git from PATH.
 */
export function configuredGitPath(value: unknown): string | undefined {
    return (Array.isArray(value) ? value : [value]).find(
        (candidate): candidate is string =>
            typeof candidate === "string" && candidate !== "" && fs.existsSync(candidate),
    );
}
