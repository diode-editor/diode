import { ConfigurationModel } from "./configurationModel.ts";
import type { IConfigurationPropertySchema } from "./configurationRegistry.ts";

/**
 * Проходит ли значение схему ключа: `type`, `enum`, `minimum`/`maximum` — то
 * подмножество JSON-schema, которое объявляют наши узлы. Аналог `validate()`
 * опций редактора vscode (`EditorBooleanOption` и соседи), но по схеме реестра,
 * а не по классу на опцию.
 */
export function isValidConfigurationValue(schema: IConfigurationPropertySchema, value: unknown): boolean {
    if (schema.enum !== undefined && !schema.enum.includes(value)) return false;
    switch (schema.type) {
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
