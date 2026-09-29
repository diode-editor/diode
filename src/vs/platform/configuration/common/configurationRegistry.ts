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
export interface IConfigurationPropertySchema {
    readonly type: "string" | "number" | "boolean" | "object" | "array" | "null";
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
export class ConfigurationRegistry {
    private readonly properties = new Map<string, IConfigurationPropertySchema>();

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

    /** Схемы всех зарегистрированных ключей (по полному dotted-ключу). */
    public getConfigurationProperties(): ReadonlyMap<string, IConfigurationPropertySchema> {
        return this.properties;
    }

    /**
     * Дефолты как вложенное дерево (`{ editor: { tabSize: 4 } }`) — форма,
     * которую ожидают `ConfigurationModel.fromRaw` и `collectKnownSettingKeys`.
     */
    public getDefaultConfiguration(): Readonly<Record<string, unknown>> {
        const tree: Record<string, unknown> = {};
        for (const [key, schema] of this.properties) {
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
            node[segments[segments.length - 1]] = schema.default;
        }
        return tree;
    }
}
