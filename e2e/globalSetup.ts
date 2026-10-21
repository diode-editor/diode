import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureE2eArtifacts } from "../scripts/e2e-artifacts.mjs";
import { setup as setupTmpRoot } from "../src/TestUtils/tmpRoot.ts";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

// Binaries are an immutable build from a shared cache keyed by the source hash (scripts/e2e-artifacts.mjs);
// the run doesn't touch the working `dist/`, so a manual `build:sea` mid-e2e breaks nothing.
// Paths reach workers via env (`DIODE_E2E_BINARY`, `DIODE_E2E_SELFEXTRACT`): forks inherit
// env at spawn time, i.e. after globalSetup; a worker never builds.
// `TMPDIR` travels the same way: the run's temp directories share one root, which
// teardown removes together with the processes living in it (src/TestUtils/tmpRoot.ts).
export default function setup(): () => void {
    const artifacts = ensureE2eArtifacts({ repoRoot });
    const teardownTmpRoot = setupTmpRoot();
    process.env.DIODE_E2E_BINARY = artifacts.binary;
    if (artifacts.selfExtract !== undefined) process.env.DIODE_E2E_SELFEXTRACT = artifacts.selfExtract;
    return () => {
        teardownTmpRoot();
        artifacts.release();
    };
}
