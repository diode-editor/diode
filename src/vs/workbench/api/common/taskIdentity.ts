// Provider task id by upstream's formula (`TaskDTO.to` + `KeyedTaskIdentifier`). Upstream
// computes it only on the main side (`$createTaskId`); here the subprocess computes it itself,
// without an extra RPC round trip (a deviation), so the formula is shared by both sides.

export interface ITaskDefinitionPropertySchema {
    readonly type?: unknown;
    readonly default?: unknown;
}

export interface ITaskDefinitionSchema {
    readonly extensionId: string;
    readonly taskType: string;
    readonly required: readonly string[];
    readonly properties: Readonly<Record<string, ITaskDefinitionPropertySchema>>;
    readonly when: string | undefined;
}

export interface ITaskIdentifier {
    readonly type: string;
    readonly [name: string]: unknown;
}

export interface IKeyedTaskIdentifier extends ITaskIdentifier {
    readonly _key: string;
}

/** Upstream's `Configuration.from`: non-string `required` entries are dropped silently, as there. */
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

/** Upstream's `sortedStringify`: keys sorted, commas in strings doubled, objects recursed into. */
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

/** Definition with a key (upstream's `KeyedTaskIdentifier.create`). */
function keyed(literal: ITaskIdentifier): IKeyedTaskIdentifier {
    return { ...literal, _key: sortedStringify(literal) };
}

/** Upstream's `TaskDefinition.createTaskIdentifier`, with its message texts. */
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
        // Stryker disable next-line ConditionalExpression: equivalent — a non-string type is not found in ZERO_VALUES anyway; the check exists only for the type checker
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

const ZERO_VALUES: ReadonlyMap<string, unknown> = new Map<string, unknown>([
    ["boolean", false],
    ["number", 0],
    ["integer", 0],
    ["string", ""],
]);

/** As upstream `TaskDTO.to`. */
export function contributedTaskId(extensionId: string, definition: IKeyedTaskIdentifier): string {
    return `${extensionId}.${definition._key}`;
}
