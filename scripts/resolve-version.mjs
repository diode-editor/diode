/**
 * Версия, «зашиваемая» в сборку. Единственный источник правды — им пользуются
 * и `tsup.config.ts` (define `__DIODE_VERSION__` внутри main.js), и
 * `build-selfextract.mjs` (ключ кэша распаковки). Разъедься они — стаб распаковывал
 * бы payload в каталог, не совпадающий с версией, которую печатает сам редактор.
 *
 * Приоритет:
 *  1. env `DIODE_VERSION` — задаётся в CI (релиз: тег `vX.Y.Z`; ночная: `nightly-<hash>`);
 *     ведущая `v` срезается.
 *  2. git-fallback — точный тег `vX.Y.Z` → его номер; иначе `nightly-<short-hash>`.
 *  3. если git недоступен → `0.0.0-dev`.
 */

import { execSync } from "node:child_process";

/**
 * @param {{ repoRoot?: string }} [params] `repoRoot` — корень репозитория, из которого
 *   спрашиваем git. По умолчанию `process.cwd()`: и tsup, и build-скрипты запускаются
 *   из корня. Резолвить от `import.meta.dirname` нельзя — tsup бандлит конфиг во
 *   временный файл, и git ушёл бы искать HEAD вверх по дереву (в worktree это давало
 *   версию основного репозитория, разъезжавшуюся с ключом кэша).
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
        // HEAD не на релизном теге — упадём в nightly-ветку ниже.
    }

    try {
        const shortSha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"], cwd })
            .toString()
            .trim();
        if (shortSha) return `nightly-${shortSha}`;
    } catch {
        // git недоступен.
    }

    return "0.0.0-dev";
}
