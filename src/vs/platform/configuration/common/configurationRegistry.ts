import { isOverrideKey } from "./configurationModel.ts";

/** Where a key **may** be overridden; ordered from the narrowest write scope to the widest. */
export type ConfigurationScope =
    | "application"
    /** A property of the environment, not the project: user or machine, but not workspace. */
    | "machine"
    /** A machine property the project may override (the JDK path for redhat.java). */
    | "machine-overridable"
    /** One value per window: user or workspace, but not a single folder. */
    | "window"
    | "resource"
    | "language-overridable";

/** `integer` — upstream's `EditorIntOption`: an out-of-range or fractional number is clamped and truncated, not replaced by the default. */
export type ConfigurationValueType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export interface IConfigurationPropertySchema {
    readonly type: ConfigurationValueType | readonly ConfigurationValueType[];
    /**
     * Absent — an unset key reads `undefined`, and so does an invalid value (as upstream, where
     * `editor.cursorStyle` without a default would be "not configured"). The typed `get` adds `undefined`.
     */
    readonly default?: unknown;
    /**
     * Required, unlike upstream's `WINDOW` default: silently getting `window`
     * for a folder key costs more than answering the question when adding the key.
     */
    readonly scope: ConfigurationScope;
    readonly description?: string;
    readonly enum?: readonly unknown[];
    readonly enumDescriptions?: readonly string[];
    readonly minimum?: number;
    readonly maximum?: number;
}

export interface IConfigurationNode {
    readonly id: string;
    readonly title?: string;
    /** Full dotted keys: `"editor.tabSize"`, not `"tabSize"`. */
    readonly properties: Readonly<Record<string, IConfigurationPropertySchema>>;
}

/** Extension schemas (`$ref`, `pattern`…) are not validated: values reach consumers as is. */
export interface IExtensionConfigurationProperty {
    readonly default: unknown;
    readonly scope: ConfigurationScope;
    readonly extensionId: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SCOPES: readonly ConfigurationScope[] = [
    "application",
    "machine",
    "machine-overridable",
    "window",
    "resource",
    "language-overridable",
];

/** Like vscode's `parseScope`; an unknown value maps to `window`. */
function parseExtensionScope(scope: unknown): ConfigurationScope {
    // Upstream's `application-machine` equals `application` for the workspace layer: both live only in user settings.
    if (scope === "application-machine") return "application";
    return SCOPES.find((s) => s === scope) ?? "window";
}

export class ConfigurationRegistry {
    private readonly properties = new Map<string, IConfigurationPropertySchema>();
    private readonly extensionProperties = new Map<string, IExtensionConfigurationProperty>();
    /** Later wins. */
    private readonly defaultOverrides = new Map<string, unknown>();

    public constructor(nodes: readonly IConfigurationNode[] = []) {
        for (const node of nodes) {
            this.registerConfiguration(node);
        }
    }

    public registerConfiguration(node: IConfigurationNode): void {
        for (const [key, schema] of Object.entries(node.properties)) {
            if (this.properties.has(key)) {
                throw new Error(`Configuration key "${key}" is already registered`);
            }
            this.properties.set(key, schema);
        }
    }

    /** A taken key is skipped with a warning instead of throwing like core does: this is a foreign manifest. */
    public registerExtensionConfiguration(
        extensionId: string,
        properties: Readonly<Record<string, { readonly default?: unknown; readonly scope?: unknown }>>,
        onProblem?: (message: string) => void,
    ): void {
        for (const [key, schema] of Object.entries(properties)) {
            const owner = this.properties.has(key) ? "core" : this.extensionProperties.get(key)?.extensionId;
            if (owner !== undefined) {
                onProblem?.(`${extensionId}: configuration key "${key}" is already registered by ${owner}, skipped`);
                continue;
            }
            this.extensionProperties.set(key, {
                default: schema.default,
                scope: parseExtensionScope(schema.scope),
                extensionId,
            });
        }
    }

    /** A repeated key overrides the earlier one; language sections (`"[go]"`) from different sources merge by key. */
    public registerDefaultConfigurations(overrides: Readonly<Record<string, unknown>>): void {
        for (const [key, value] of Object.entries(overrides)) {
            const existing = this.defaultOverrides.get(key);
            this.defaultOverrides.set(
                key,
                isOverrideKey(key) && isPlainObject(existing) && isPlainObject(value)
                    ? { ...existing, ...value }
                    : value,
            );
        }
    }

    public getExtensionConfigurationProperties(): ReadonlyMap<string, IExtensionConfigurationProperty> {
        return this.extensionProperties;
    }

    public getConfigurationScopes(): ReadonlyMap<string, ConfigurationScope> {
        const scopes = new Map<string, ConfigurationScope>();
        for (const [key, schema] of this.properties) scopes.set(key, schema.scope);
        for (const [key, property] of this.extensionProperties) scopes.set(key, property.scope);
        return scopes;
    }

    public getConfigurationProperties(): ReadonlyMap<string, IConfigurationPropertySchema> {
        return this.properties;
    }

    /** A nested tree (`{ editor: { tabSize: 4 } }`), not flat dotted keys. */
    public getDefaultConfiguration(): Readonly<Record<string, unknown>> {
        const defaults = new Map<string, unknown>();
        for (const [key, schema] of this.properties) {
            if (schema.default !== undefined) defaults.set(key, schema.default);
        }
        for (const [key, property] of this.extensionProperties) {
            if (property.default !== undefined) defaults.set(key, property.default);
        }
        for (const [key, value] of this.defaultOverrides) defaults.set(key, value);
        const tree: Record<string, unknown> = {};
        for (const [key, value] of defaults) {
            const segments = key.split(".");
            let node = tree;
            for (const segment of segments.slice(0, -1)) {
                const existing = node[segment];
                if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
                    node = existing as Record<string, unknown>;
                } else {
                    const child: Record<string, unknown> = {};
                    node[segment] = child;
                    node = child;
                }
            }
            node[segments[segments.length - 1]] = value;
        }
        return tree;
    }
}
