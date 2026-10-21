/**
 * Single version source for `__DIODE_VERSION__` (tsup) and the self-extract cache key:
 * if they diverged, the stub would unpack the payload into another version's directory.
 *
 * Priority: env `DIODE_VERSION` (CI) -> exact tag `vX.Y.Z` -> `nightly-<short-hash>` -> `0.0.0-dev`.
 */

import { execSync } from "node:child_process";

/**
 * @param {{ repoRoot?: string }} [params] Defaults to `process.cwd()`, not
 *   `import.meta.dirname`: tsup bundles the config into a temp file, and in a worktree git
 *   would return the main repository's HEAD.
 * @returns {string}
 */
export function resolveDiodeVersion(params = {}) {
    const cwd = params.repoRoot ?? process.cwd();

    const fromEnv = process.env.DIODE_VERSION?.trim();
    if (fromEnv) return fromEnv.replace(/^v/, "");

    try {
        const tag = execSync("git describe --tags --exact-match", { stdio: ["ignore", "pipe", "ignore"], cwd })
            .toString()
            .trim();
        if (/^v\d/.test(tag)) return tag.replace(/^v/, "");
    } catch {
        // HEAD is not on a release tag.
    }

    try {
        const shortSha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"], cwd })
            .toString()
            .trim();
        if (shortSha) return `nightly-${shortSha}`;
    } catch {
        // git is unavailable.
    }

    return "0.0.0-dev";
}
