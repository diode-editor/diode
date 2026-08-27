import { compareSemver, parseSemver, satisfiesSemverRange } from "../../../base/common/semver.ts";
import type { IRegistryVersion } from "./registryFormat.ts";

/**
 * Версии хоста для матчинга `engines` записей реестра. Чистый параметр:
 * platform не знает, откуда берутся значения (вызывающий передаёт
 * `DIODE_VERSION` и версию vscode-шима).
 */
export interface IHostVersions {
    /** Версия Diode (`DIODE_VERSION`); в dev-запуске — `"0.0.0-dev"`. */
    readonly diode: string;
    /** Версия vscode-шима (лок-степ с `extensions/VSCODE_VERSION`). */
    readonly vscode: string;
}

/** Dev-запуск через tsx: настоящей версии нет, diode-канал не блокирует установку. */
const DEV_VERSION = "0.0.0-dev";

/**
 * Совместима ли версия записи с хостом. Правила: `engines.diode` матчится
 * против версии Diode (нативная декларация), `engines.vscode` — против версии
 * vscode-шима (путь прокси-расширений); заданы оба — пройти должны оба.
 * Для dev-версии Diode diode-канал считается пройденным; у vscode-канала
 * такого исключения нет — версия шима всегда реальна.
 */
export function isVersionCompatible(version: IRegistryVersion, host: IHostVersions): boolean {
    const { diode, vscode } = version.engines;
    if (diode !== undefined && host.diode !== DEV_VERSION && !satisfiesSemverRange(host.diode, diode)) {
        return false;
    }
    if (vscode !== undefined && !satisfiesSemverRange(host.vscode, vscode)) {
        return false;
    }
    return true;
}

/**
 * Выбирает наивысшую версию, совместимую с хостом; нет совместимых —
 * `undefined`. Порядок `versions` не является контрактом формата — сортируем сами.
 */
export function resolveCompatibleVersion(
    versions: readonly IRegistryVersion[],
    host: IHostVersions,
): IRegistryVersion | undefined {
    let best: IRegistryVersion | undefined;
    let bestParsed: ReturnType<typeof parseSemver>;
    for (const candidate of versions) {
        if (!isVersionCompatible(candidate, host)) continue;
        const parsed = parseSemver(candidate.version);
        // Парсер формата пропускает только semver-версии, но IRegistryVersion
        // может быть собран программно — неразбираемая версия не участвует.
        if (parsed === undefined) continue;
        if (bestParsed === undefined || compareSemver(parsed, bestParsed) > 0) {
            best = candidate;
            bestParsed = parsed;
        }
    }
    return best;
}
