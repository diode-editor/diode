import type { IAssetAccess } from "../../../base/common/assets/iAssetAccess.ts";
import { UI_LOCALE } from "../../environment/common/uiLocale.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

import { localizeExtensionManifest } from "./extensionNls.ts";
import type { IExtension } from "./iExtension.ts";
import type { IExtensionManifest } from "./iExtensionManifest.ts";

export interface IScanExtensionsOptions {
    readonly isBuiltin?: boolean;
    readonly locale?: string;
}

/**
 * Только каталоги первого уровня под `rootPrefix`; `IExtension.location` — их
 * виртуальный prefix с `/` на конце. Битые манифесты пропускаются с записью в
 * лог: bootstrap не падает из-за одного криво скопированного расширения.
 * Единственная точка локализации манифестов, и builtin, и установленных.
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
    const locale = options.locale ?? UI_LOCALE;

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

        // После валидации: битый nls-бандл не должен решать, расширение ли это вообще.
        const localized = await localizeExtensionManifest(manifest, assets, extensionPrefix, locale, logger);

        result.push({
            id: `${manifest.publisher}.${manifest.name}`,
            manifest: localized,
            location: extensionPrefix,
            isBuiltin,
        });
    }
    return result;
}

export function scanBuiltinExtensions(assets: IAssetAccess, rootPrefix: string): Promise<IExtension[]> {
    return scanExtensions(assets, rootPrefix, { isBuiltin: true });
}
