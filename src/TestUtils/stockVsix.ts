import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSemver } from "../vs/base/common/semver.ts";
import { DIODE_VERSION } from "../vs/base/common/version.ts";
import { resolveCompatibleVersion } from "../vs/platform/extensionManagement/common/resolveCompatibleVersion.ts";
import {
    createRegistrySource,
    DEFAULT_REGISTRY_URL,
} from "../vs/platform/extensionManagement/node/createRegistrySource.ts";
import { sha256File } from "../vs/platform/extensionManagement/node/installFromRegistry.ts";
import { currentTargetPlatform } from "../vs/platform/extensionManagement/node/targetPlatform.ts";
import { VSCODE_SHIM_VERSION } from "../vs/workbench/api/common/vscodeShimVersion.ts";

/** Resolved as the client does; the cache is validated by the metadata `sha256`, not by file presence. */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const VSIX_CACHE_DIR = path.join(REPO_ROOT, "node_modules", ".cache", "diode-stock-vsix");

export interface IStockVsix {
    readonly vsixPath: string;
    readonly version: string;
}

export async function fetchStockVsix(id: string): Promise<IStockVsix> {
    const source = createRegistrySource(DEFAULT_REGISTRY_URL);
    const meta = await source.getMeta(id);
    if (meta === undefined) {
        throw new Error(`${id} is not published in the registry at ${DEFAULT_REGISTRY_URL}`);
    }
    const version = resolveCompatibleVersion(
        meta.versions,
        {
            diode: DIODE_VERSION,
            vscode: VSCODE_SHIM_VERSION,
            targetPlatform: currentTargetPlatform(),
        },
        await loadSemver(),
    );
    if (version === undefined) {
        throw new Error(`${id}: no version compatible with this build in the registry`);
    }
    // A mounted node_modules survives a platform change.
    const platformSuffix = version.targetPlatform === undefined ? "" : `@${version.targetPlatform}`;
    const cached = path.join(VSIX_CACHE_DIR, `${id}-${version.version}${platformSuffix}.vsix`);
    if (fs.existsSync(cached) && (await sha256File(cached)) === version.sha256) {
        return { vsixPath: cached, version: version.version };
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-stock-vsix-"));
    try {
        const artifact = await source.fetchArtifact(version, tempDir);
        const actualSha = await sha256File(artifact);
        if (actualSha !== version.sha256) {
            throw new Error(
                `sha256 mismatch for ${id}@${version.version}: registry declares ${version.sha256}, artifact is ${actualSha}`,
            );
        }
        fs.mkdirSync(VSIX_CACHE_DIR, { recursive: true });
        // Temp inside the cache: rename is atomic only within one file system. A random suffix,
        // not just the pid: vitest workers are threads of one process, and the second one failed with ENOENT.
        const staging = `${cached}.${String(process.pid)}.${randomBytes(6).toString("hex")}.tmp`;
        fs.copyFileSync(artifact, staging);
        fs.renameSync(staging, cached);
        return { vsixPath: cached, version: version.version };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
