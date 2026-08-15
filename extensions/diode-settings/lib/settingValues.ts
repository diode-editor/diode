import type { ISettingSchemaEntry } from "../settings-schema.generated.ts";

/**
 * Candidate values to offer for a setting, already rendered as JSON literals
 * (strings come back quoted). Empty when the schema says nothing useful.
 *
 * Ordered by how much the schema actually knows:
 *  - `enum` — the full closed set (`terminal.tier`, `workbench.colorTheme`);
 *  - `boolean` — the only other closed set;
 *  - otherwise the default, as a starting point to edit.
 */
export function completionValuesFor(entry: ISettingSchemaEntry): string[] {
    if (entry.enum !== undefined && entry.enum.length > 0) {
        return entry.enum.map((value) => JSON.stringify(value));
    }
    if (entry.type === "boolean") return ["true", "false"];
    if (entry.default !== undefined) return [JSON.stringify(entry.default)];
    return [];
}
