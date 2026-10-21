import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureE2eArtifacts } from "../../scripts/e2e-artifacts.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..");

let artifacts: { binary: string; selfExtract: string | undefined } | null = null;

/**
 * Under `test:e2e` the path comes from `globalSetup` via `DIODE_E2E_BINARY`, and the worker NEVER builds —
 * even if the file is missing. Outside a test run (screenshots, benches) — an immutable build from the
 * cache keyed by source hash (scripts/e2e-artifacts.mjs), not `dist/`.
 */
export function getBinaryPath(): Promise<string> {
    try {
        return Promise.resolve(resolveInjected("DIODE_E2E_BINARY") ?? fromCache().binary);
    } catch (err) {
        return Promise.reject(err as Error);
    }
}

/**
 * Self-extracting binary (#144), same rules (`DIODE_E2E_SELFEXTRACT`). `--node=host`: tests do not need
 * the release node, and the network is an extra point of failure in e2e. Not available on Windows.
 */
export function getSelfExtractPath(): Promise<string> {
    try {
        const path = resolveInjected("DIODE_E2E_SELFEXTRACT") ?? fromCache().selfExtract;
        if (path === undefined) throw new Error("self-extract is not built on this platform");
        return Promise.resolve(path);
    } catch (err) {
        return Promise.reject(err as Error);
    }
}

function fromCache(): { binary: string; selfExtract: string | undefined } {
    if (artifacts === null) {
        const built = ensureE2eArtifacts({ repoRoot });
        // The "build in use" mark lives as long as the process: eviction leaves it alone.
        process.once("exit", built.release);
        artifacts = built;
    }
    return artifacts;
}

/** The path from env, if set; a set but missing file is an error, not a rebuild. */
function resolveInjected(envName: string): string | undefined {
    const injected = process.env[envName];
    if (injected === undefined || injected.length === 0) return undefined;
    if (!existsSync(injected)) {
        throw new Error(
            `${envName}=${injected}: file not found. Under test:e2e the build comes from globalSetup's cache ` +
                `(scripts/e2e-artifacts.mjs) and is read-only — it can only vanish mid-run if the cache ` +
                `was deleted by hand. The worker does not rebuild itself: that would break its neighbors.`,
        );
    }
    return injected;
}
