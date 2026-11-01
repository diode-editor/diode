import { ConfigurationModel } from "./configurationModel.ts";
import type {
    ConfigurationScope,
    ConfigurationValueType,
    IConfigurationPropertySchema,
} from "./configurationRegistry.ts";
import { WORKSPACE_SCOPES } from "./workspaceSettings.ts";

/** Counterpart of vscode's editor option `validate()`, driven by the registry schema rather than a class per option. */
export function isValidConfigurationValue(schema: IConfigurationPropertySchema, value: unknown): boolean {
    if (schema.enum !== undefined && !schema.enum.includes(value)) return false;
    const types: readonly ConfigurationValueType[] = typeof schema.type === "string" ? [schema.type] : schema.type;
    return types.some((type) => matchesType(type, schema, value));
}

function matchesType(type: ConfigurationValueType, schema: IConfigurationPropertySchema, value: unknown): boolean {
    switch (type) {
        case "number":
            return isFiniteNumber(value) && inRange(schema, value);
        case "integer":
            return Number.isInteger(value) && inRange(schema, value as number);
        case "boolean":
            return typeof value === "boolean";
        case "string":
            return typeof value === "string";
        case "array":
            return Array.isArray(value);
        case "object":
            return typeof value === "object" && value !== null && !Array.isArray(value);
        case "null":
            return value === null;
    }
}

function isFiniteNumber(value: unknown): value is number {
    return Number.isFinite(value);
}

function inRange(schema: IConfigurationPropertySchema, value: number): boolean {
    return (
        value >= (schema.minimum ?? Number.NEGATIVE_INFINITY) && value <= (schema.maximum ?? Number.POSITIVE_INFINITY)
    );
}

/**
 * The value an invalid one is replaced with: the default, except for an `integer` given a number (or a numeric
 * string) — upstream `EditorIntOption.clampedInt` clamps it into the range and truncates.
 */
function fixedValue(schema: IConfigurationPropertySchema, value: unknown): unknown {
    if (typeof value === "boolean" && schema.booleanEquivalents !== undefined) {
        return value ? schema.booleanEquivalents.true : schema.booleanEquivalents.false;
    }
    if (schema.type !== "integer") return schema.default;
    const parsed = typeof value === "string" ? parseInt(value, 10) : value;
    if (!isFiniteNumber(parsed)) return schema.default;
    const clamped = Math.min(
        schema.maximum ?? Number.POSITIVE_INFINITY,
        Math.max(schema.minimum ?? Number.NEGATIVE_INFINITY, parsed),
    );
    return Math.trunc(clamped);
}

/** Unregistered keys (extension settings) pass through as is. */
export function sanitizeConfiguration(
    model: ConfigurationModel,
    schemas: ReadonlyMap<string, IConfigurationPropertySchema>,
): ConfigurationModel {
    const fixes: Record<string, unknown> = {};
    let invalid = false;
    for (const [key, schema] of schemas) {
        const value = model.get(key);
        if (value === undefined || isValidConfigurationValue(schema, value)) continue;
        fixes[key] = fixedValue(schema, value);
        invalid = true;
    }
    return invalid ? ConfigurationModel.merge(model, ConfigurationModel.fromRaw(fixes)) : model;
}

/**
 * Core keys that are not `language-overridable` are ignored in a section, as in VS Code; keys
 * outside the core schema (extension settings) apply as is.
 */
export function languageConfiguration(
    merged: ConfigurationModel,
    identifier: string,
    schemas: ReadonlyMap<string, IConfigurationPropertySchema>,
): ConfigurationModel {
    const section = structuredClone(merged.getOverride(identifier).getValue()) as Record<string, unknown>;
    for (const [key, schema] of schemas) {
        if (schema.scope !== "language-overridable") deletePath(section, key.split("."));
    }
    return sanitizeConfiguration(ConfigurationModel.merge(merged, ConfigurationModel.fromRaw(section)), schemas);
}

function deletePath(tree: Record<string, unknown>, segments: readonly string[]): void {
    const [head, ...rest] = segments;
    if (rest.length === 0) {
        Reflect.deleteProperty(tree, head);
        return;
    }
    const child = tree[head];
    if (typeof child === "object" && child !== null && !Array.isArray(child)) {
        deletePath(child as Record<string, unknown>, rest);
    }
}

export interface IWorkspaceSettingsFilterResult {
    readonly model: ConfigurationModel;
    /** Inside a language section, prefixed with `[lang].`. */
    readonly excludedKeys: readonly string[];
}

/** Like the `scopes` filter of upstream's `ConfigurationModelParser`; a key outside the registry passes as is. */
export function filterWorkspaceSettings(
    model: ConfigurationModel,
    scopes: ReadonlyMap<string, ConfigurationScope>,
    allowed: readonly ConfigurationScope[] = WORKSPACE_SCOPES,
): IWorkspaceSettingsFilterResult {
    const raw = structuredClone(model.toRaw());
    const excludedKeys: string[] = [];
    for (const [key, scope] of scopes) {
        if (allowed.includes(scope)) continue;
        if (model.get(key) !== undefined) {
            prunePath(raw, key.split("."));
            excludedKeys.push(key);
        }
        for (const identifier of model.getOverrideIdentifiers()) {
            if (model.getOverride(identifier).get(key) === undefined) continue;
            prunePath(raw[`[${identifier}]`] as Record<string, unknown>, key.split("."));
            excludedKeys.push(`[${identifier}].${key}`);
        }
    }
    return { model: excludedKeys.length === 0 ? model : ConfigurationModel.fromRaw(raw), excludedKeys };
}

/** Unlike {@link filterWorkspaceSettings}, a key outside the registry is dropped (upstream's `skipUnregistered`). */
export function pickRegisteredSettings(
    model: ConfigurationModel,
    scopes: ReadonlyMap<string, ConfigurationScope>,
    allowed: readonly ConfigurationScope[],
): ConfigurationModel {
    const raw: Record<string, unknown> = {};
    for (const [key, scope] of scopes) {
        if (!allowed.includes(scope)) continue;
        const value = model.get(key);
        if (value !== undefined) raw[key] = value;
        for (const identifier of model.getOverrideIdentifiers()) {
            const override = model.getOverride(identifier).get(key);
            if (override === undefined) continue;
            const section = (raw[`[${identifier}]`] ??= {}) as Record<string, unknown>;
            section[key] = override;
        }
    }
    return Object.keys(raw).length === 0 ? ConfigurationModel.EMPTY : ConfigurationModel.fromRaw(raw);
}

/** Along with emptied ancestors: `terminal: {}` would otherwise reach the host as a section value. */
function prunePath(tree: Record<string, unknown>, segments: readonly string[]): void {
    const [head, ...rest] = segments;
    if (rest.length > 0) {
        const child = tree[head] as Record<string, unknown>;
        prunePath(child, rest);
        if (Object.keys(child).length > 0) return;
    }
    Reflect.deleteProperty(tree, head);
}
