import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { IExtensionRegistrySource } from "../common/iExtensionRegistrySource.ts";
import type { IRegistryVersion } from "../common/registryFormat.ts";
import { resolveCompatibleVersion, type IHostVersions } from "../common/resolveCompatibleVersion.ts";
import { installVsix, uninstallExtension } from "./extensionInstaller.ts";

/**
 * Установка расширения из реестра: мета → выбор совместимой версии →
 * артефакт → проверка sha256 → существующий {@link installVsix}.
 *
 * Модуль чистый (без DI/логгера/UI) — как `extensionInstaller.ts`; печать и
 * коды выхода на вызывающем. Источник артефакта абстрагирован
 * {@link IExtensionRegistrySource}: сегодня файловый каталог, позже HTTP.
 */

export interface IInstallFromRegistryOptions {
    readonly extensionsDir: string;
    /** Версии хоста для матчинга `engines` (см. {@link IHostVersions}). */
    readonly host: IHostVersions;
    /** Точная версия; не задана — наивысшая совместимая. */
    readonly version?: string;
}

/** sha256 файла стримингом, hex lowercase. Экспортирован для тестов и CI-тулинга реестра. */
export function sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("error", reject);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => {
            resolve(hash.digest("hex"));
        });
    });
}

/** `1.2.0 (diode ^0.3.0, vscode ^1.90.0)` — для сообщения «нет совместимой версии». */
function describeVersion(v: IRegistryVersion): string {
    const engines = [
        v.engines.diode !== undefined ? `diode ${v.engines.diode}` : undefined,
        v.engines.vscode !== undefined ? `vscode ${v.engines.vscode}` : undefined,
    ]
        .filter((part) => part !== undefined)
        .join(", ");
    return `${v.version} (${engines})`;
}

/**
 * Устанавливает `extensionId` из `source` в `extensionsDir`. Ошибки — понятными
 * сообщениями: неизвестный id, нет совместимой версии (с перечислением
 * имеющихся и их engines), sha256 mismatch (файл не устанавливается).
 *
 * После установки сверяется фактический id из манифеста `.vsix` с запрошенным —
 * реестр мог указать чужой артефакт; при расхождении установленное сносится
 * ({@link uninstallExtension} фактического id) и бросается ошибка.
 */
export async function installFromRegistry(
    source: IExtensionRegistrySource,
    extensionId: string,
    options: IInstallFromRegistryOptions,
): Promise<{ id: string; version: string; previous: string[] }> {
    const meta = await source.getMeta(extensionId);
    if (meta === undefined) {
        throw new Error(`Extension "${extensionId}" not found in registry`);
    }

    let picked: IRegistryVersion | undefined;
    if (options.version !== undefined) {
        picked = meta.versions.find((v) => v.version === options.version);
        if (picked === undefined) {
            throw new Error(
                `Extension "${extensionId}" has no version ${options.version} in registry; available: ${meta.versions.map((v) => v.version).join(", ")}`,
            );
        }
    } else {
        picked = resolveCompatibleVersion(meta.versions, options.host);
        if (picked === undefined) {
            throw new Error(
                `Extension "${extensionId}" has no version compatible with this build (diode ${options.host.diode}, vscode ${options.host.vscode}); available: ${meta.versions.map(describeVersion).join(", ")}`,
            );
        }
    }

    // Temp для скачиваемых байтов — в os.tmpdir(), НЕ в extensionsDir: там
    // временные каталоги заводит сам installVsix, и посторонний temp сбил бы
    // его учёт установленных версий.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-registry-install-"));
    try {
        const vsixPath = await source.fetchArtifact(picked, tempDir);

        const actualSha = await sha256File(vsixPath);
        if (actualSha !== picked.sha256) {
            throw new Error(
                `sha256 mismatch for ${extensionId}@${picked.version}: registry declares ${picked.sha256}, artifact is ${actualSha} — refusing to install`,
            );
        }

        const installed = await installVsix(vsixPath, options.extensionsDir);
        if (installed.id !== extensionId) {
            uninstallExtension(installed.id, options.extensionsDir);
            throw new Error(
                `Registry entry "${extensionId}" points to a .vsix of "${installed.id}" — installation rolled back`,
            );
        }
        return installed;
    } finally {
        // Stryker disable next-line BooleanLiteral: force прикрывает только отсутствующий каталог, а его создаёт mkdtempSync выше по функции — на этом пути подмена ненаблюдаема; флаг оставлен, чтобы сбой уборки не затирал исходную ошибку
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
