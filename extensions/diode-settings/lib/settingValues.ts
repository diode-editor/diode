import type { ISettingSchemaEntry } from "../settings-schema.generated.ts";

/** JSON literals (strings come back quoted). */
export function completionValuesFor(entry: ISettingSchemaEntry): string[] {
    if (entry.enum !== undefined && entry.enum.length > 0) {
        return entry.enum.map((value) => JSON.stringify(value));
    }
    if (entry.type === "boolean") return ["true", "false"];
    if (entry.default !== undefined) return [JSON.stringify(entry.default)];
    return [];
}
