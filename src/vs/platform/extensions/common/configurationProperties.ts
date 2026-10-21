import type { IConfigurationContribution, IConfigurationPropertySchema } from "./iExtensionManifest.ts";

/** Non-object schemas are skipped. */
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
