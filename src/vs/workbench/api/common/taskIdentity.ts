// Идентичность задачи — общая для ядра и субпроцесса расширений.
//
// Задачу провайдера ядро называет `${id расширения}.${_key определения}`
// (`TaskDTO.to` в `mainThreadTask.ts` эталона), а `_key` — сортированная
// строка свойств определения (`KeyedTaskIdentifier` в `contrib/tasks/common/
// tasks.ts`), отфильтрованных по схеме типа из `contributes.taskDefinitions`.
// Эталон считает id только на главной стороне и спрашивает его запросом
// `$createTaskId`; у нас субпроцесс считает ту же формулу сам (отступление —
// без лишнего круга RPC), поэтому она живёт здесь, в одном месте для обеих
// сторон.

/** Свойство определения из схемы типа: важны только `type` и `default`. */
export interface ITaskDefinitionPropertySchema {
    readonly type?: unknown;
    readonly default?: unknown;
}

/**
 * Тип задачи из `contributes.taskDefinitions` расширения (`ITaskDefinition`
 * эталона): обязательные и известные свойства и условие `when`.
 */
export interface ITaskDefinitionSchema {
    readonly extensionId: string;
    readonly taskType: string;
    readonly required: readonly string[];
    readonly properties: Readonly<Record<string, ITaskDefinitionPropertySchema>>;
    readonly when: string | undefined;
}

/** Определение задачи (`vscode.TaskDefinition`): `type` и произвольные свойства. */
export interface ITaskIdentifier {
    readonly type: string;
    readonly [name: string]: unknown;
}

/** Определение с ключом: по `_key` задачи сравниваются между собой. */
export interface IKeyedTaskIdentifier extends ITaskIdentifier {
    readonly _key: string;
}

/**
 * `contributes.taskDefinitions` манифеста → схемы типов (`Configuration.from`
 * эталона). Запись без строкового `type` пропускается и называется в `report`;
 * нестроковые элементы `required` отбрасываются молча, как у эталона.
 */
export function parseTaskDefinitions(
    extensionId: string,
    contributions: unknown,
    report: (message: string) => void,
): ITaskDefinitionSchema[] {
    if (!Array.isArray(contributions)) return [];
    const result: ITaskDefinitionSchema[] = [];
    for (const value of contributions as readonly unknown[]) {
        const entry = (value ?? {}) as Partial<Record<"type" | "required" | "properties" | "when", unknown>>;
        if (typeof entry.type !== "string" || entry.type.length === 0) {
            report("The task type configuration is missing the required 'taskType' property");
            continue;
        }
        const required = Array.isArray(entry.required)
            ? (entry.required as unknown[]).filter((element): element is string => typeof element === "string")
            : [];
        const properties =
            typeof entry.properties === "object" && entry.properties !== null
                ? (structuredClone(entry.properties) as Record<string, ITaskDefinitionPropertySchema>)
                : {};
        result.push({
            extensionId,
            taskType: entry.type,
            required,
            properties,
            when: typeof entry.when === "string" && entry.when !== "" ? entry.when : undefined,
        });
    }
    return result;
}

/** `sortedStringify` эталона: ключи по алфавиту, запятые в строках удвоены, объекты — рекурсивно. */
function sortedStringify(literal: Readonly<Record<string, unknown>>): string {
    let result = "";
    for (const key of Object.keys(literal).sort()) {
        let stringified = literal[key];
        if (stringified instanceof Object) {
            stringified = sortedStringify(stringified as Record<string, unknown>);
        } else if (typeof stringified === "string") {
            stringified = stringified.replace(/,/g, ",,");
        }
        result += `${key},${String(stringified)},`;
    }
    return result;
}

/** Определение с ключом (`KeyedTaskIdentifier.create` эталона). */
function keyed(literal: ITaskIdentifier): IKeyedTaskIdentifier {
    return { ...literal, _key: sortedStringify(literal) };
}

/**
 * Определение с ключом (`TaskDefinition.createTaskIdentifier` эталона). Тип
 * без схемы берётся как есть (без прежнего `_key`); у типа со схемой остаются
 * только объявленные свойства, а пропущенное обязательное получает дефолт
 * схемы или нулевое значение своего типа. Обязательное свойство без дефолта и
 * без простого типа делает определение негодным — `undefined` и сообщение в
 * `report` (текст эталона).
 */
export function createTaskIdentifier(
    external: ITaskIdentifier,
    schema: ITaskDefinitionSchema | undefined,
    report: (message: string) => void,
): IKeyedTaskIdentifier | undefined {
    if (schema === undefined) {
        const { _key: _ignored, ...copy } = structuredClone(external) as ITaskIdentifier & { _key?: unknown };
        return keyed(copy as ITaskIdentifier);
    }
    const literal: Record<string, unknown> = { type: schema.taskType };
    for (const property of Object.keys(schema.properties)) {
        const value = external[property];
        if (value !== undefined && value !== null) {
            literal[property] = value;
            continue;
        }
        if (!schema.required.includes(property)) continue;
        const propertySchema = schema.properties[property];
        if (propertySchema.default !== undefined) {
            literal[property] = structuredClone(propertySchema.default);
            continue;
        }
        // Stryker disable next-line ConditionalExpression: эквивалентный — не строковый type и так не найдётся в ZERO_VALUES; проверка нужна только типам
        if (typeof propertySchema.type !== "string" || !ZERO_VALUES.has(propertySchema.type)) {
            report(
                `Error: the task identifier '${JSON.stringify(external)}' is missing the required property '${property}'. The task identifier will be ignored.`,
            );
            return undefined;
        }
        literal[property] = ZERO_VALUES.get(propertySchema.type);
    }
    return keyed(literal as ITaskIdentifier);
}

/** Значение пропущенного обязательного свойства без дефолта — по его типу в схеме. */
const ZERO_VALUES: ReadonlyMap<string, unknown> = new Map<string, unknown>([
    ["boolean", false],
    ["number", 0],
    ["integer", 0],
    ["string", ""],
]);

/** Id задачи провайдера (`TaskDTO.to` эталона): расширение плюс ключ определения. */
export function contributedTaskId(extensionId: string, definition: IKeyedTaskIdentifier): string {
    return `${extensionId}.${definition._key}`;
}
