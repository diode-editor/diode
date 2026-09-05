import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    parseRegistryIndex,
    type IRegistryIndex,
} from "../../src/vs/platform/extensionManagement/common/registryFormat.ts";
import { DEFAULT_REGISTRY_URL } from "../../src/vs/platform/extensionManagement/node/createRegistrySource.ts";

/**
 * Обвязка системы тестирования расширений: установка по id из НАСТОЯЩЕГО
 * опубликованного реестра и чтение его индекса.
 *
 * Адрес берём из клиентского `DEFAULT_REGISTRY_URL`, а не из своей копии строки:
 * сьют обязан ходить ровно туда, куда пойдёт пользователь без флагов.
 */

export const PUBLISHED_REGISTRY_URL = DEFAULT_REGISTRY_URL;

export interface ICliResult {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

/** Запускает собранный бинарь и собирает вывод (тот же путь, что у пользователя). */
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
 * Скачивает опубликованный `index.json` и разбирает его **нормативным парсером
 * клиента**. Именно эта пара (живые данные + `parseRegistryIndex`) ловит
 * расхождение упрощённых проверок сборщика реестра с форматом: сборщик живёт в
 * репозитории сайта и наших типов не видит.
 */
export async function fetchPublishedIndex(): Promise<{ index: IRegistryIndex; problems: string[] }> {
    const url = new URL("index.json", PUBLISHED_REGISTRY_URL);
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
        throw new Error(`${url.href}: HTTP ${String(response.status)} ${response.statusText}`);
    }
    return parseRegistryIndex(await response.text());
}

/**
 * Изолированный корень сессии в раскладке `prepareAppEnv`: расширение ставится в
 * `<root>/user-data-dir`, после чего тот же корень переиспользуется запуском
 * редактора (`startHeadlessApp({ root })`) — приложение видит ровно то, что
 * поставил CLI.
 */
export function createMarketplaceRoot(): { root: string; userDataDir: string } {
    const root = mkdtempSync(join(tmpdir(), "diode-marketplace-e2e-"));
    return { root, userDataDir: join(root, "user-data-dir") };
}
