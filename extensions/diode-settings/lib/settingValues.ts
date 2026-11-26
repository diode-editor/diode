/** The part of a schema with values to suggest: a setting, or an attribute of a launch configuration. */
export interface IValueSchema {
    readonly type?: string | readonly string[];
    readonly enum?: readonly unknown[];
    readonly default?: unknown;
}

/** JSON literals (strings come back quoted). */
export function completionValuesFor(entry: IValueSchema): string[] {
    if (entry.enum !== undefined && entry.enum.length > 0) {
        return entry.enum.map((value) => JSON.stringify(value));
    }
    if ([entry.type].flat().includes("boolean")) return ["true", "false"];
    if (entry.default !== undefined) return [JSON.stringify(entry.default)];
    return [];
}
