import type { IConfigurationContribution } from "./iExtensionManifest.ts";

/**
 * Сплющивает `contributes.configuration` расширения в dotted-map дефолтов
 * (`{ "editorconfig.generateAuto": true }`). Ключи `properties` — уже полные
 * dotted-пути настроек. Блок может быть объектом или массивом объектов.
 *
 * Используется при регистрации расширений в extension host (`main.ts`) и в
 * интеграционных тестах, которые собирают регистрацию установленного vsix
 * из его манифеста той же логикой, что и приложение.
 */
export function flattenConfigDefaults(
    configuration: IConfigurationContribution | readonly IConfigurationContribution[] | undefined,
): Record<string, unknown> | undefined {
    if (configuration === undefined) return undefined;
    const blocks = Array.isArray(configuration) ? configuration : [configuration];
    const defaults: Record<string, unknown> = {};
    for (const block of blocks as readonly IConfigurationContribution[]) {
        const properties = block.properties;
        if (properties === undefined) continue;
        for (const [key, schema] of Object.entries(properties) as [string, unknown][]) {
            if (schema !== null && typeof schema === "object" && "default" in schema) {
                defaults[key] = schema.default;
            }
        }
    }
    return Object.keys(defaults).length > 0 ? defaults : undefined;
}
