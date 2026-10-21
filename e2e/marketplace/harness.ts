import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSemver } from "../../src/vs/base/common/semver.ts";
import {
    parseRegistryIndex,
    type IRegistryIndex,
} from "../../src/vs/platform/extensionManagement/common/registryFormat.ts";
import { DEFAULT_REGISTRY_URL } from "../../src/vs/platform/extensionManagement/node/createRegistrySource.ts";

/**
 * Адрес — из клиентского `DEFAULT_REGISTRY_URL`, а не из своей копии строки: сьют обязан ходить
 * туда же, куда пользователь без флагов.
 */

export const PUBLISHED_REGISTRY_URL = DEFAULT_REGISTRY_URL;

export interface ICliResult {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

export function runCli(binary: string, args: readonly string[]): Promise<ICliResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
        child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

/**
 * Разбор **нормативным парсером клиента** — единственная проверка, что упрощённые правила сборщика
 * реестра (он в репозитории сайта и наших типов не видит) не разошлись с форматом.
 */
export async function fetchPublishedIndex(): Promise<{ index: IRegistryIndex; problems: string[] }> {
    const url = new URL("index.json", PUBLISHED_REGISTRY_URL);
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
        throw new Error(`${url.href}: HTTP ${String(response.status)} ${response.statusText}`);
    }
    return parseRegistryIndex(await response.text(), await loadSemver());
}

/** Тот же корень переиспользуется запуском редактора — приложение видит ровно то, что поставил CLI. */
export function createMarketplaceRoot(): { root: string; userDataDir: string } {
    const root = mkdtempSync(join(tmpdir(), "diode-marketplace-e2e-"));
    return { root, userDataDir: join(root, "user-data-dir") };
}
