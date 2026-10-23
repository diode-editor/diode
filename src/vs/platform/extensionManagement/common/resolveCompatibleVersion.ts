import type { Semver } from "../../../base/common/semver.ts";

import type { IRegistryEngines, IRegistryVersion } from "./registryFormat.ts";

export interface IHostVersions {
    /** `"0.0.0-dev"` in a dev run. */
    readonly diode: string;
    readonly vscode: string;
    /** Unset means only universal versions match: an exotic platform must not get a foreign native binary. */
    readonly targetPlatform?: string;
}

const DEV_VERSION = "0.0.0-dev";

/** "No version" comes in two forms: `0.0.0-dev` (valid but fake semver) and nightly `nightly-<sha>`. */
function hasReleaseVersion(version: string, semver: Semver): boolean {
    return version !== DEV_VERSION && semver.valid(version) !== null;
}

/**
 * node-semver, as in VS Code: we don't write `engines`, so we need the full range
 * language and rejection of prereleases the range didn't ask for. No options means strict parsing.
 */
function satisfies(version: string, range: string, semver: Semver): boolean {
    return semver.satisfies(version, range);
}

export function isVersionCompatible(version: IRegistryVersion, host: IHostVersions, semver: Semver): boolean {
    return matchesHostPlatform(version, host) && areEnginesCompatible(version.engines, host, semver);
}

/** Separate because an exact version (`--install-extension id` with `version`) bypasses engines, but not the platform. */
export function matchesHostPlatform(version: IRegistryVersion, host: IHostVersions): boolean {
    return version.targetPlatform === undefined || version.targetPlatform === host.targetPlatform;
}

/**
 * A build without a release version (dev, nightly) passes the diode channel; otherwise
 * no native extension could be installed on it. The shim version is always real, so vscode has no exception.
 */
export function areEnginesCompatible(engines: IRegistryEngines, host: IHostVersions, semver: Semver): boolean {
    const { diode, vscode } = engines;
    if (diode !== undefined && hasReleaseVersion(host.diode, semver) && !satisfies(host.diode, diode, semver)) {
        return false;
    }
    if (vscode !== undefined && !satisfies(host.vscode, vscode, semver)) {
        return false;
    }
    return true;
}

/**
 * Upstream `getAllCompatibleVersions` for the version picker: newest first, one record per version
 * (the platform one over universal, like {@link resolveCompatibleVersion}).
 */
export function compatibleVersions(
    versions: readonly IRegistryVersion[],
    host: IHostVersions,
    semver: Semver,
): IRegistryVersion[] {
    const byVersion = new Map<string, IRegistryVersion>();
    for (const candidate of versions) {
        if (!isVersionCompatible(candidate, host, semver) || semver.valid(candidate.version) === null) continue;
        const known = byVersion.get(candidate.version);
        if (known?.targetPlatform === undefined) byVersion.set(candidate.version, candidate);
    }
    return [...byVersion.values()].sort((a, b) => semver.rcompare(a.version, b.version));
}

/** `versions` order is not part of the format contract. On equal semver, a platform record beats universal. */
export function resolveCompatibleVersion(
    versions: readonly IRegistryVersion[],
    host: IHostVersions,
    semver: Semver,
): IRegistryVersion | undefined {
    let best: IRegistryVersion | undefined;
    for (const candidate of versions) {
        if (!isVersionCompatible(candidate, host, semver)) continue;
        // The parser admits only semver, but an IRegistryVersion may be built programmatically.
        if (semver.valid(candidate.version) === null) continue;
        if (
            best === undefined ||
            semver.gt(candidate.version, best.version) ||
            (semver.eq(candidate.version, best.version) &&
                best.targetPlatform === undefined &&
                candidate.targetPlatform !== undefined)
        ) {
            best = candidate;
        }
    }
    return best;
}
