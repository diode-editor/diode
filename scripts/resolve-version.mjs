/**
 * Один источник версии для `__DIODE_VERSION__` (tsup) и ключа кэша self-extract:
 * разъедься они — стаб распаковывал бы payload не в каталог своей версии.
 *
 * Приоритет: env `DIODE_VERSION` (CI) → точный тег `vX.Y.Z` → `nightly-<short-hash>` → `0.0.0-dev`.
 */

import { execSync } from "node:child_process";

/**
 * @param {{ repoRoot?: string }} [params] По умолчанию `process.cwd()`, а не
 *   `import.meta.dirname`: tsup бандлит конфиг во временный файл, и в worktree git
 *   отдавал бы HEAD основного репозитория.
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
        // HEAD не на релизном теге.
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
