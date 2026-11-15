// Upstream's `ConfigurationResolverExpression`: the `${…}` occurrences of a string or of a JSON tree (in values and
// keys, at any depth), resolved one variable at a time. A resolved value is scanned for variables again
// (`${env:A}` = `${env:B}`), but never for the one that produced it.

/** `${name:arg}` as it occurs in the text. */
export interface IReplacement {
    /** `${name:arg}` */
    readonly id: string;
    /** `name:arg` */
    readonly inner: string;
    readonly name: string;
    readonly arg?: string;
}

interface IPropertyLocation {
    readonly object: Record<string, unknown>;
    propertyName: string;
    readonly replaceKeyName: boolean;
}

interface IReplacementLocation {
    readonly replacement: IReplacement;
    readonly locations: IPropertyLocation[];
    resolved?: string;
}

export class ConfigurationResolverExpression<T> {
    private readonly locations = new Map<string, IReplacementLocation>();
    private readonly root: Record<string, unknown>;
    private readonly stringRoot: boolean;

    private constructor(object: T) {
        this.stringRoot = typeof object === "string";
        this.root = this.stringRoot ? { value: object } : (structuredClone(object) as Record<string, unknown>);
    }

    public static parse<T>(object: T): ConfigurationResolverExpression<T> {
        const expression = new ConfigurationResolverExpression(object);
        expression.parseObject(expression.root);
        return expression;
    }

    /** Includes variables found in resolved values while iterating (they are appended); each id once. */
    public *unresolved(): Generator<IReplacement> {
        const yielded = new Set<string>();
        for (;;) {
            const next = [...this.locations.values()].find(
                ({ replacement, resolved }) => resolved === undefined && !yielded.has(replacement.id),
            );
            if (next === undefined) return;
            yielded.add(next.replacement.id);
            yield next.replacement;
        }
    }

    /** Keyed by `name:arg`. */
    public resolvedValues(): Map<string, string> {
        const values = new Map<string, string>();
        for (const { replacement, resolved } of this.locations.values()) {
            if (resolved !== undefined) values.set(replacement.inner, resolved);
        }
        return values;
    }

    /** A variable that does not occur is ignored. */
    public resolve(replacement: IReplacement, value: string): void {
        const location = this.locations.get(replacement.id);
        if (location === undefined) return;
        location.resolved = value;
        for (const at of location.locations) this.resolveAt(replacement, at, value, NO_PATH);
    }

    /** Unresolved variables stay as they are. */
    public toObject(): T {
        return (this.stringRoot ? this.root.value : this.root) as T;
    }

    /** Arrays too: their indexes are keys without variables. */
    private parseObject(object: unknown): void {
        if (typeof object !== "object" || object === null) return;
        const record = object as Record<string, unknown>;
        for (const [key, value] of Object.entries(record)) {
            this.parseString(record, key, key, true, NO_PATH);
            if (typeof value === "string") this.parseString(record, key, value, false, NO_PATH);
            else this.parseObject(value);
        }
    }

    /** `path`: the variables whose values are being scanned, against `${env:A}` = `${env:A}` cycles. */
    private parseString(
        object: Record<string, unknown>,
        propertyName: string,
        value: string,
        replaceKeyName: boolean,
        path: readonly string[],
    ): void {
        let position = 0;
        for (;;) {
            const start = value.indexOf("${", position);
            if (start === -1) return;
            const replacement = parseVariable(value, start);
            if (replacement === undefined) {
                position = start + 2;
                continue;
            }
            position = start + replacement.id.length;
            if (path.includes(replacement.id)) continue;
            const location = this.locations.get(replacement.id) ?? { replacement, locations: [] };
            const at: IPropertyLocation = { object, propertyName, replaceKeyName };
            location.locations.push(at);
            this.locations.set(replacement.id, location);
            if (location.resolved !== undefined) this.resolveAt(replacement, at, location.resolved, path);
        }
    }

    private resolveAt(replacement: IReplacement, at: IPropertyLocation, value: string, path: readonly string[]): void {
        const scanned = [...path, replacement.id];
        const { object, propertyName } = at;
        if (at.replaceKeyName) {
            const key = propertyName;
            const newKey = key.replaceAll(replacement.id, value);
            const property = object[key];
            // Re-added below under the new name: the key moves to the end, as upstream.
            Reflect.deleteProperty(object, key);
            object[newKey] = property;
            this.renameKey(object, key, newKey);
            // Only the substituted text is scanned again, not the whole string.
            this.parseString(object, newKey, value, true, scanned);
        } else {
            object[propertyName] = (object[propertyName] as string).replaceAll(replacement.id, value);
            this.parseString(object, propertyName, value, false, scanned);
        }
    }

    private renameKey(object: object, oldKey: string, newKey: string): void {
        for (const { locations } of this.locations.values()) {
            for (const at of locations) {
                if (at.object === object && at.propertyName === oldKey) at.propertyName = newKey;
            }
        }
    }
}

// Stryker disable next-line ArrayDeclaration: equivalent: no variable has the id a mutant puts here
const NO_PATH: readonly string[] = [];

/** `${…}` with balanced braces from `start`; `undefined` if it is never closed. */
function parseVariable(text: string, start: number): IReplacement | undefined {
    let depth = 0;
    // Stryker disable next-line EqualityOperator: equivalent: `text[text.length]` is no brace
    for (let end = start + 1; end < text.length; end++) {
        if (text[end] === "{") depth++;
        else if (text[end] === "}" && --depth === 0) {
            const id = text.slice(start, end + 1);
            const inner = text.slice(start + 2, end);
            const colon = inner.indexOf(":");
            return colon === -1
                ? { id, inner, name: inner }
                : { id, inner, name: inner.slice(0, colon), arg: inner.slice(colon + 1) };
        }
    }
    return undefined;
}
