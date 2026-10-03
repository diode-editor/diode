import type { IConfigurationContribution, IConfigurationPropertySchema } from "./iExtensionManifest.ts";

/**
 * Свойства `contributes.configuration` расширения одной map'ой по полному
 * dotted-ключу (`{ "editorconfig.generateAuto": { type, default, scope } }`).
 * Блок может быть объектом или массивом объектов; не-объектные схемы
 * пропускаются.
 *
 * Отсюда настройки расширения регистрирует в общем `ConfigurationRegistry`
 * `ExtensionConfigurationContributor` — один источник дефолтов для ядра и
 * extension host'а.
 */
export function collectConfigurationProperties(
    configuration: IConfigurationContribution | readonly IConfigurationContribution[] | undefined,
): Record<string, IConfigurationPropertySchema> {
    const properties: Record<string, IConfigurationPropertySchema> = {};
    if (configuration === undefined) return properties;
    const blocks = Array.isArray(configuration) ? configuration : [configuration];
    for (const block of blocks as readonly IConfigurationContribution[]) {
        for (const [key, schema] of Object.entries(block.properties ?? {}) as [string, unknown][]) {
            if (schema !== null && typeof schema === "object") properties[key] = schema as IConfigurationPropertySchema;
        }
    }
    return properties;
}
