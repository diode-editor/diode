import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureE2eArtifacts } from "../../scripts/e2e-artifacts.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..");

let artifacts: { binary: string; selfExtract: string | undefined } | null = null;

/**
 * Под `test:e2e` путь отдаёт `globalSetup` через `DIODE_E2E_BINARY`, и воркер НЕ собирает никогда —
 * даже если файла нет. Вне прогона (screenshots, бенчи) — неизменяемая сборка из кэша по хешу
 * исходников (scripts/e2e-artifacts.mjs), а не `dist/`.
 */
export function getBinaryPath(): Promise<string> {
    try {
        return Promise.resolve(resolveInjected("DIODE_E2E_BINARY") ?? fromCache().binary);
    } catch (err) {
        return Promise.reject(err as Error);
    }
}

/**
 * Self-extracting бинарь (#144), правила те же (`DIODE_E2E_SELFEXTRACT`). `--node=host`: релизный
 * node тестам не нужен, а сеть в e2e — лишняя точка отказа. Под Windows его нет.
 */
export function getSelfExtractPath(): Promise<string> {
    try {
        const path = resolveInjected("DIODE_E2E_SELFEXTRACT") ?? fromCache().selfExtract;
        if (path === undefined) throw new Error("self-extract на этой платформе не собирается");
        return Promise.resolve(path);
    } catch (err) {
        return Promise.reject(err as Error);
    }
}

function fromCache(): { binary: string; selfExtract: string | undefined } {
    if (artifacts === null) {
        const built = ensureE2eArtifacts({ repoRoot });
        // Метка «сборка используется» живёт, пока жив процесс: вытеснение её не тронет.
        process.once("exit", built.release);
        artifacts = built;
    }
    return artifacts;
}

/** Путь из env, если он задан; заданный, но пропавший файл — ошибка, а не пересборка. */
function resolveInjected(envName: string): string | undefined {
    const injected = process.env[envName];
    if (injected === undefined || injected.length === 0) return undefined;
    if (!existsSync(injected)) {
        throw new Error(
            `${envName}=${injected}: файла нет. Под test:e2e сборку отдаёт globalSetup из кэша ` +
                `(scripts/e2e-artifacts.mjs), и она read-only — пропасть посреди прогона ей нечем, ` +
                `кроме ручного сноса кэша. Воркер сам не пересобирает: это сломало бы соседей.`,
        );
    }
    return injected;
}
