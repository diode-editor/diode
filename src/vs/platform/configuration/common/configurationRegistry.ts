import { isOverrideKey } from "./configurationModel.ts";

/** Где ключ **разрешено** переопределять; порядок — от самой узкой области записи к самой широкой. */
export type ConfigurationScope =
    | "application"
    /** Свойство окружения, а не проекта: user или машина, но не воркспейс. */
    | "machine"
    /** Свойство машины, которое проекту разрешено переопределить (путь к JDK у redhat.java). */
    | "machine-overridable"
    /** Одно значение на окно: user или воркспейс, но не отдельная папка. */
    | "window"
    | "resource"
    | "language-overridable";

export type ConfigurationValueType = "string" | "number" | "boolean" | "object" | "array" | "null";

export interface IConfigurationPropertySchema {
    readonly type: ConfigurationValueType | readonly ConfigurationValueType[];
    readonly default: unknown;
    /**
     * Обязательное, в отличие от эталона с дефолтом `WINDOW`: молча получить `window`
     * у ключа про папку дороже, чем ответить на вопрос при заведении ключа.
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
    /** Полные dotted-ключи: `"editor.tabSize"`, не `"tabSize"`. */
    readonly properties: Readonly<Record<string, IConfigurationPropertySchema>>;
}

/** Схему расширения (`$ref`, `pattern`…) не валидируем: значения идут к потребителям как есть. */
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

/** Как `parseScope` vscode; незнакомое значение — `window`. */
function parseExtensionScope(scope: unknown): ConfigurationScope {
    // `application-machine` эталона для слоя воркспейса равен `application`: оба только в user-настройках.
    if (scope === "application-machine") return "application";
    return SCOPES.find((s) => s === scope) ?? "window";
}

export class ConfigurationRegistry {
    private readonly properties = new Map<string, IConfigurationPropertySchema>();
    private readonly extensionProperties = new Map<string, IExtensionConfigurationProperty>();
    /** Позднее — главнее. */
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

    /** Занятый ключ пропускается с предупреждением, а не бросает, как у ядра: здесь это чужой манифест. */
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

    /** Повторная запись ключа главнее прежней; секции языков (`"[go]"`) от разных источников сливаются по ключам. */
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

    /** Вложенное дерево (`{ editor: { tabSize: 4 } }`), а не плоские dotted-ключи. */
    public getDefaultConfiguration(): Readonly<Record<string, unknown>> {
        const defaults = new Map<string, unknown>();
        for (const [key, schema] of this.properties) defaults.set(key, schema.default);
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
