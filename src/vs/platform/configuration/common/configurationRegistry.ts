import { isOverrideKey } from "./configurationModel.ts";

/**
 * Область, в которой ключ настроек **разрешено** переопределять (аналог
 * `ConfigurationScope` vscode). Порядок — от самой узкой области записи к самой
 * широкой области действия.
 *
 * Поле-декларация: слоёв конфигурации ниже user'а у нас пока нет вовсе (ни
 * `.code-workspace`, ни `<folder>/.vscode/settings.json`), поэтому **никто его
 * не читает**. Размечается оно сейчас именно поэтому: задним числом это была бы
 * ревизия семантики каждого существующего ключа, а не механическая правка (см.
 * `docs/TODO/MultiRoot.md`, M6).
 */
export type ConfigurationScope =
    /** Только user-настройки: воркспейсу такой ключ не отдаём (`files.hotExit` у эталона). */
    | "application"
    /** User или настройки машины, но не воркспейс: свойство окружения, а не проекта. */
    | "machine"
    /**
     * Свойство машины, которое проекту всё же разрешено переопределить (путь к
     * JDK у redhat.java). Объявляют только расширения; в воркспейс ложится.
     */
    | "machine-overridable"
    /** User или воркспейс, но не отдельная папка: одно значение на окно. */
    | "window"
    /** Вплоть до папки: у каждой папки воркспейса может быть своё значение. */
    | "resource"
    /** Как `resource`, плюс переопределение на язык (`"[python]": { … }`). */
    | "language-overridable";

/**
 * Схема одного ключа настроек (подмножество JSON-schema, как у
 * `IConfigurationPropertySchema` vscode): тип, дефолт, {@link ConfigurationScope}
 * и опциональные описание/enum — то, что нужно defaults-слою конфигурации,
 * валидации settings.json и автодополнению ключей.
 */
/** Тип значения ключа (JSON-schema `type`). */
export type ConfigurationValueType = "string" | "number" | "boolean" | "object" | "array" | "null";

export interface IConfigurationPropertySchema {
    /** Тип значения или несколько допустимых (`["object", "array"]`), как в JSON-schema. */
    readonly type: ConfigurationValueType | readonly ConfigurationValueType[];
    /** JSON-совместимое значение по умолчанию. */
    readonly default: unknown;
    /**
     * Где ключ можно переопределять. Обязательное — в отличие от эталона, где
     * поле опционально с дефолтом `WINDOW`: у нас ключей всего десятки, и молча
     * получить `window` у ключа, который на самом деле про папку, дороже, чем
     * ответить на вопрос при заведении ключа.
     */
    readonly scope: ConfigurationScope;
    readonly description?: string;
    readonly enum?: readonly unknown[];
    /** Описания значений {@link enum} по позициям (`enumDescriptions` у эталона) — для документации и подсказок. */
    readonly enumDescriptions?: readonly string[];
    /** Нижняя граница числа (JSON-schema `minimum`); значение меньше — невалидно. */
    readonly minimum?: number;
    /** Верхняя граница числа (JSON-schema `maximum`). */
    readonly maximum?: number;
}

/**
 * Узел конфигурации фичи (аналог `IConfigurationNode` vscode): секция
 * настроек с полными dotted-ключами в `properties`
 * (`"editor.tabSize"`, не `"tabSize"`).
 */
export interface IConfigurationNode {
    /** Идентификатор секции (`"editor"`, `"terminal"`). */
    readonly id: string;
    readonly title?: string;
    readonly properties: Readonly<Record<string, IConfigurationPropertySchema>>;
}

/**
 * Contribution point схем настроек (аналог `IConfigurationRegistry` vscode,
 * `vs/platform/configuration/common/configurationRegistry.ts`): фичи
 * описывают свои настройки узлами {@link IConfigurationNode}, реестр
 * агрегирует схемы по dotted-ключу и деривирует из них defaults-слой
 * конфигурации. Узлы приложения — явный массив `CONFIGURATION_CONTRIBUTIONS`
 * (`Workbench/Configuration/configurationContributions.ts`; наша конвенция
 * вместо `Registry.as(...)` с import-side-effects), реестр собирается на
 * bootstrap в `main.ts` и уходит в `loadConfiguration` и DI.
 */
/**
 * Ключ настроек из `contributes.configuration` расширения. Схема расширения —
 * полноценный JSON-schema (массивы типов, `$ref`, `pattern`…), которую мы не
 * валидируем: храним дефолт, область и владельца. Значения таких ключей идут к
 * потребителям как есть.
 */
export interface IExtensionConfigurationProperty {
    readonly default: unknown;
    readonly scope: ConfigurationScope;
    /** Расширение-владелец (`publisher.name`). */
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

/**
 * Область ключа расширения: как `parseScope` vscode — без поля `WINDOW`;
 * `application-machine` у нас приравнен к `application` (для слоя воркспейса
 * они равны: оба только в user-настройках), а незнакомое значение — к `window`.
 */
function parseExtensionScope(scope: unknown): ConfigurationScope {
    // `application-machine` эталона — тот же `APPLICATION_SCOPES`: только user-настройки.
    if (scope === "application-machine") return "application";
    return SCOPES.find((s) => s === scope) ?? "window";
}

export class ConfigurationRegistry {
    private readonly properties = new Map<string, IConfigurationPropertySchema>();
    private readonly extensionProperties = new Map<string, IExtensionConfigurationProperty>();
    /** Переопределения дефолтов (`configurationDefaults` и курируемые инъекции); позднее — главнее. */
    private readonly defaultOverrides = new Map<string, unknown>();

    public constructor(nodes: readonly IConfigurationNode[] = []) {
        for (const node of nodes) {
            this.registerConfiguration(node);
        }
    }

    /** Регистрирует узел; повторная регистрация ключа — ошибка программиста. */
    public registerConfiguration(node: IConfigurationNode): void {
        for (const [key, schema] of Object.entries(node.properties)) {
            if (this.properties.has(key)) {
                throw new Error(`Configuration key "${key}" is already registered`);
            }
            this.properties.set(key, schema);
        }
    }

    /**
     * Регистрирует настройки расширения (аналог `configurationExtPoint` vscode,
     * `deltaConfiguration`): ключ, уже занятый ядром или другим расширением, не
     * перетирается — `onProblem` получает предупреждение, ключ пропускается
     * (ядро на дубль бросает: там это ошибка программиста, здесь — чужой манифест).
     *
     * @param properties `properties` блоков `contributes.configuration`, ключи — полные dotted.
     */
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

    /**
     * Переопределяет дефолты ключей (аналог `registerDefaultConfigurations`
     * vscode): `contributes.configurationDefaults` и курируемые инъекции. Ключи —
     * полные dotted; повторная запись того же ключа — главнее прежней. Секции
     * языков (`"[go]": { … }`) от разных источников сливаются по ключам.
     */
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

    /** Ключи настроек расширений с владельцем и областью. */
    public getExtensionConfigurationProperties(): ReadonlyMap<string, IExtensionConfigurationProperty> {
        return this.extensionProperties;
    }

    /**
     * `scope` каждого зарегистрированного ключа — ядра и расширений. По нему слой
     * воркспейса решает, какие ключи из `.diode/settings.json` действуют.
     */
    public getConfigurationScopes(): ReadonlyMap<string, ConfigurationScope> {
        const scopes = new Map<string, ConfigurationScope>();
        for (const [key, schema] of this.properties) scopes.set(key, schema.scope);
        for (const [key, property] of this.extensionProperties) scopes.set(key, property.scope);
        return scopes;
    }

    /** Схемы ключей ядра (по полному dotted-ключу); по ним идёт валидация значений. */
    public getConfigurationProperties(): ReadonlyMap<string, IConfigurationPropertySchema> {
        return this.properties;
    }

    /**
     * Дефолты как вложенное дерево (`{ editor: { tabSize: 4 } }`) — форма,
     * которую ожидают `ConfigurationModel.fromRaw` и `collectKnownSettingKeys`.
     */
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
