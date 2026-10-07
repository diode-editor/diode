import { ConfigurationModel } from "./configurationModel.ts";
import type {
    ConfigurationScope,
    ConfigurationValueType,
    IConfigurationPropertySchema,
} from "./configurationRegistry.ts";
import { isWorkspaceScope } from "./workspaceSettings.ts";

/**
 * Проходит ли значение схему ключа: `type` (один или любой из списка), `enum`,
 * `minimum`/`maximum` — то подмножество JSON-schema, которое объявляют наши
 * узлы. Аналог `validate()` опций редактора vscode (`EditorBooleanOption` и
 * соседи), но по схеме реестра, а не по классу на опцию.
 */
export function isValidConfigurationValue(schema: IConfigurationPropertySchema, value: unknown): boolean {
    if (schema.enum !== undefined && !schema.enum.includes(value)) return false;
    const types: readonly ConfigurationValueType[] = typeof schema.type === "string" ? [schema.type] : schema.type;
    return types.some((type) => matchesType(type, schema, value));
}

function matchesType(type: ConfigurationValueType, schema: IConfigurationPropertySchema, value: unknown): boolean {
    switch (type) {
        case "number":
            return (
                isFiniteNumber(value) &&
                value >= (schema.minimum ?? Number.NEGATIVE_INFINITY) &&
                value <= (schema.maximum ?? Number.POSITIVE_INFINITY)
            );
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

/** `Number.isFinite` с сужением типа: не-числа он и так отвергает, без приведения. */
function isFiniteNumber(value: unknown): value is number {
    return Number.isFinite(value);
}

/**
 * Итоговая модель, в которой значение каждого зарегистрированного ключа,
 * не прошедшее его схему, заменено дефолтом схемы. Мусор из settings.json
 * (`"editor.tabSize": "four"`, неизвестный режим `editor.wordWrap`) так не
 * доезжает до потребителей — санировать его на месте вызова не нужно.
 * Незарегистрированные ключи (настройки расширений) идут как есть.
 */
export function sanitizeConfiguration(
    model: ConfigurationModel,
    schemas: ReadonlyMap<string, IConfigurationPropertySchema>,
): ConfigurationModel {
    const fixes: Record<string, unknown> = {};
    let invalid = false;
    for (const [key, schema] of schemas) {
        const value = model.get(key);
        if (value === undefined || isValidConfigurationValue(schema, value)) continue;
        fixes[key] = schema.default;
        invalid = true;
    }
    return invalid ? ConfigurationModel.merge(model, ConfigurationModel.fromRaw(fixes)) : model;
}

/**
 * Модель для языка: итоговое значение, поверх — секция `"[identifier]"` из
 * слитых слоёв, без ключей ядра, которые не объявлены `language-overridable`
 * (их значение в секции игнорируется, как у VS Code), и уже прошедшее схему.
 * Ключи вне схемы ядра (настройки расширений) в секции действуют как есть.
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
    /** Слой без ключей чужого скоупа — в основном дереве и в секциях языков. */
    readonly model: ConfigurationModel;
    /** Отброшенные ключи (dotted; в секции языка — с префиксом `[lang].`) — чтобы назвать их человеку в логе. */
    readonly excludedKeys: readonly string[];
}

/**
 * Слой воркспейса без ключей, чей `scope` воркспейсу не положен (как фильтр по
 * `scopes` у `ConfigurationModelParser` эталона): `application`/`machine`-ключ в
 * `.diode/settings.json` не действует — ни в основном дереве, ни в секции
 * языка. Скоупы — ключей ядра и расширений
 * (`ConfigurationRegistry.getConfigurationScopes`); ключ вне реестра идёт как есть.
 */
export function filterWorkspaceSettings(
    model: ConfigurationModel,
    scopes: ReadonlyMap<string, ConfigurationScope>,
): IWorkspaceSettingsFilterResult {
    const raw = structuredClone(model.toRaw());
    const excludedKeys: string[] = [];
    for (const [key, scope] of scopes) {
        if (isWorkspaceScope(scope)) continue;
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

/**
 * Удаляет ключ из дерева вместе с опустевшими предками: отброшенный
 * `terminal.tier` не должен оставлять в слое `terminal: {}` — пустой объект
 * перекрыл бы при слиянии ничего, но доехал бы до хоста как значение секции.
 */
function prunePath(tree: Record<string, unknown>, segments: readonly string[]): void {
    const [head, ...rest] = segments;
    if (rest.length > 0) {
        const child = tree[head] as Record<string, unknown>;
        prunePath(child, rest);
        if (Object.keys(child).length > 0) return;
    }
    Reflect.deleteProperty(tree, head);
}
