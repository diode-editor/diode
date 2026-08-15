import type { IAssetAccess } from "../../../base/common/assets/iAssetAccess.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

import type { IExtension } from "./iExtension.ts";
import type { IExtensionManifest } from "./iExtensionManifest.ts";

export interface IScanExtensionsOptions {
    /** Помечать ли найденные расширения как builtin. По умолчанию `true`. */
    readonly isBuiltin?: boolean;
}

/**
 * Сканирует виртуальный каталог `<rootPrefix><extension>/package.json` через
 * {@link IAssetAccess}, парсит манифесты и возвращает список валидных
 * расширений. `rootPrefix` должен заканчиваться на `/` (например
 * `"Extensions/builtin/"` для builtin или `"UserExtensions/"` для
 * `~/.diode/extensions/`, замапленного через `FsAssetAccess`).
 *
 * Битые манифесты (отсутствие `name`/`publisher`/`version`, невалидный JSON,
 * отсутствующий `package.json`) пропускаются с записью в `logger.error` —
 * bootstrap не должен падать из-за одного криво скопированного расширения.
 *
 * Сканирование строго неглубокое: только поддиректории первого уровня под
 * `rootPrefix`. `IExtension.location` устанавливается в виртуальный prefix
 * расширения (с trailing `/`), пригодный для join'а через `joinVirtualPath`.
 */
export async function scanExtensions(
    assets: IAssetAccess,
    rootPrefix: string,
    options: IScanExtensionsOptions = {},
    logger?: ILogger,
): Promise<IExtension[]> {
    if (!rootPrefix.endsWith("/")) {
        throw new Error(`scanExtensions: rootPrefix must end with "/": ${rootPrefix}`);
    }
    const isBuiltin = options.isBuiltin ?? true;

    let entries;
    try {
        entries = await assets.listEntries(rootPrefix);
    } catch (err) {
        logger?.error(`Failed to scan extensions in ${rootPrefix}`, err);
        return [];
    }

    const result: IExtension[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory) continue;
        const extensionPrefix = `${rootPrefix}${entry.name}/`;
        const manifestPath = `${extensionPrefix}package.json`;

        if (!(await assets.exists(manifestPath))) {
            // Каталог без package.json — не расширение, тихо пропускаем.
            continue;
        }

        let raw: string;
        try {
            raw = await assets.readText(manifestPath);
        } catch (err) {
            logger?.error(`Failed to read ${manifestPath}`, err);
            continue;
        }

        let manifest: IExtensionManifest;
        try {
            manifest = JSON.parse(raw) as IExtensionManifest;
        } catch (err) {
            logger?.error(`Invalid JSON in ${manifestPath}`, err);
            continue;
        }

        if (typeof manifest.name !== "string" || manifest.name.length === 0) {
            logger?.error(`Extension ${manifestPath} has no "name" field`);
            continue;
        }
        if (typeof manifest.publisher !== "string" || manifest.publisher.length === 0) {
            logger?.error(`Extension ${manifestPath} has no "publisher" field`);
            continue;
        }
        if (typeof manifest.version !== "string" || manifest.version.length === 0) {
            logger?.error(`Extension ${manifestPath} has no "version" field`);
            continue;
        }

        result.push({
            id: `${manifest.publisher}.${manifest.name}`,
            manifest,
            location: extensionPrefix,
            isBuiltin,
        });
    }
    return result;
}

/**
 * Backward-совместимая обёртка: эквивалент `scanExtensions(assets, prefix, { isBuiltin: true })`.
 */
export function scanBuiltinExtensions(assets: IAssetAccess, rootPrefix: string): Promise<IExtension[]> {
    return scanExtensions(assets, rootPrefix, { isBuiltin: true });
}
