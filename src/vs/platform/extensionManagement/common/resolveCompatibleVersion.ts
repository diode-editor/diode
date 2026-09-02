import semver from "semver";

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

/** Заглушка версии в dev-запуске через tsx (`src/vs/base/common/version.ts`). */
const DEV_VERSION = "0.0.0-dev";

/**
 * Есть ли у сборки настоящая версия, по которой можно судить о совместимости.
 * Две формы «версии нет»: dev-запуск через tsx (`0.0.0-dev` — формально
 * валидный semver, но фиктивный) и ночная сборка (`nightly-<sha>` — вообще не
 * semver). В обоих случаях сравнивать с диапазоном нечего.
 */
function hasReleaseVersion(version: string): boolean {
    return version !== DEV_VERSION && semver.valid(version) !== null;
}

/**
 * Матчинг диапазона — семантикой node-semver, ровно как у VS Code: `engines`
 * пишем не мы (у прокси-расширений это авторский `engines.vscode` из стока),
 * поэтому понимать надо весь язык диапазонов — `||`, `1.2.x`, дефисные
 * диапазоны — и не подхватывать prerelease, который диапазон не запрашивал
 * (`1.5.0-beta` вне `^1.2.3`). Неразбираемые версия или диапазон → `false`.
 * Опции не передаём: дефолт node-semver — как раз строгий разбор.
 */
function satisfies(version: string, range: string): boolean {
    return semver.satisfies(version, range);
}

/**
 * Совместима ли версия записи с хостом. Правила: `engines.diode` матчится
 * против версии Diode (нативная декларация), `engines.vscode` — против версии
 * vscode-шима (путь прокси-расширений); заданы оба — пройти должны оба.
 * У сборки без релизной версии (dev, nightly) diode-канал считается пройденным:
 * иначе на таких сборках не поставить ни одного нативного расширения. У
 * vscode-канала исключения нет — версия шима всегда реальна.
 */
export function isVersionCompatible(version: IRegistryVersion, host: IHostVersions): boolean {
    const { diode, vscode } = version.engines;
    if (diode !== undefined && hasReleaseVersion(host.diode) && !satisfies(host.diode, diode)) {
        return false;
    }
    if (vscode !== undefined && !satisfies(host.vscode, vscode)) {
        return false;
    }
    return true;
}

/**
 * Выбирает наивысшую версию, совместимую с хостом; нет совместимых —
 * `undefined`. Порядок `versions` не является контрактом формата — сравниваем сами.
 */
export function resolveCompatibleVersion(
    versions: readonly IRegistryVersion[],
    host: IHostVersions,
): IRegistryVersion | undefined {
    let best: IRegistryVersion | undefined;
    for (const candidate of versions) {
        if (!isVersionCompatible(candidate, host)) continue;
        // Парсер формата пропускает только semver-версии, но IRegistryVersion
        // может быть собран программно — неразбираемая версия не участвует.
        if (semver.valid(candidate.version) === null) continue;
        if (best === undefined || semver.gt(candidate.version, best.version)) {
            best = candidate;
        }
    }
    return best;
}
