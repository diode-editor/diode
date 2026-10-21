import type { Semver } from "../../../base/common/semver.ts";

import type { IRegistryEngines, IRegistryVersion } from "./registryFormat.ts";

export interface IHostVersions {
    /** В dev-запуске — `"0.0.0-dev"`. */
    readonly diode: string;
    readonly vscode: string;
    /** Не задан — совместимы только universal: экзотическая платформа не должна получить чужой нативный бинарь. */
    readonly targetPlatform?: string;
}

const DEV_VERSION = "0.0.0-dev";

/** «Версии нет» в двух формах: `0.0.0-dev` (валидный, но фиктивный semver) и ночная `nightly-<sha>`. */
function hasReleaseVersion(version: string, semver: Semver): boolean {
    return version !== DEV_VERSION && semver.valid(version) !== null;
}

/**
 * node-semver, как у VS Code: `engines` пишем не мы, нужен весь язык диапазонов и
 * отказ prerelease, который диапазон не запрашивал. Дефолт без опций — строгий разбор.
 */
function satisfies(version: string, range: string, semver: Semver): boolean {
    return semver.satisfies(version, range);
}

export function isVersionCompatible(version: IRegistryVersion, host: IHostVersions, semver: Semver): boolean {
    return matchesHostPlatform(version, host) && areEnginesCompatible(version.engines, host, semver);
}

/** Отдельно: точная версия (`--install-extension id` с `version`) обходит engines, но не платформу. */
export function matchesHostPlatform(version: IRegistryVersion, host: IHostVersions): boolean {
    return version.targetPlatform === undefined || version.targetPlatform === host.targetPlatform;
}

/**
 * Сборка без релизной версии (dev, nightly) проходит diode-канал: иначе на ней не
 * поставить ни одного нативного расширения. Версия шима всегда реальна — у vscode исключения нет.
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

/** Порядок `versions` — не контракт формата. При равном semver платформенная запись побеждает universal. */
export function resolveCompatibleVersion(
    versions: readonly IRegistryVersion[],
    host: IHostVersions,
    semver: Semver,
): IRegistryVersion | undefined {
    let best: IRegistryVersion | undefined;
    for (const candidate of versions) {
        if (!isVersionCompatible(candidate, host, semver)) continue;
        // Парсер пропускает только semver, но IRegistryVersion может быть собран программно.
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
