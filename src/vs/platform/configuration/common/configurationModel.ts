/**
 * Merges like VS Code: arrays are not concatenated, objects merge recursively.
 * Language sections are stored apart from the main tree; {@link override} applies
 * to the already merged model, so `[lang]` of any layer beats a plain value of any layer.
 */
export class ConfigurationModel {
    public static readonly EMPTY = new ConfigurationModel({}, new Map());

    private readonly tree: ReadonlyTree;
    private readonly overrides: ReadonlyMap<string, ReadonlyTree>;

    private constructor(tree: ReadonlyTree, overrides: ReadonlyMap<string, ReadonlyTree>) {
        this.tree = tree;
        this.overrides = overrides;
    }

    /** A non-object at the top level yields an empty model. */
    public static fromRaw(raw: unknown): ConfigurationModel {
        if (!isPlainObject(raw)) return ConfigurationModel.EMPTY;
        const contents: Record<string, unknown> = {};
        const overrides = new Map<string, Record<string, unknown>>();
        for (const [key, value] of Object.entries(raw)) {
            const identifiers = overrideIdentifiersOf(key);
            if (identifiers === null) {
                contents[key] = value;
                continue;
            }
            // A language section is a settings object; anything else (a typo) is ignored.
            if (!isPlainObject(value)) continue;
            const section = normalizeNode(value);
            for (const identifier of identifiers) {
                overrides.set(identifier, deepMerge(overrides.get(identifier) ?? {}, section));
            }
        }
        return new ConfigurationModel(normalizeNode(contents), overrides);
    }

    public static merge(...layers: readonly ConfigurationModel[]): ConfigurationModel {
        if (layers.length === 0) return ConfigurationModel.EMPTY;
        if (layers.length === 1) return layers[0];
        let acc: ReadonlyTree = {};
        const overrides = new Map<string, ReadonlyTree>();
        for (const layer of layers) {
            acc = deepMerge(acc, layer.tree);
            for (const [identifier, section] of layer.overrides) {
                overrides.set(identifier, deepMerge(overrides.get(identifier) ?? {}, section));
            }
        }
        return new ConfigurationModel(acc, overrides);
    }

    public getOverrideIdentifiers(): string[] {
        return [...this.overrides.keys()];
    }

    /** Without the main tree. */
    public getOverride(identifier: string): ConfigurationModel {
        const section = this.overrides.get(identifier);
        return section === undefined ? ConfigurationModel.EMPTY : new ConfigurationModel(section, new Map());
    }

    public override(identifier: string): ConfigurationModel {
        const section = this.overrides.get(identifier);
        if (section === undefined) return this;
        return new ConfigurationModel(deepMerge(this.tree, section), new Map());
    }

    /** Reversible via {@link fromRaw}: this is how a layer travels to the extension host. */
    public toRaw(): Record<string, unknown> {
        const raw: Record<string, unknown> = { ...this.tree };
        for (const [identifier, section] of this.overrides) raw[`[${identifier}]`] = section;
        return raw;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    public get<T>(key: string): T | undefined {
        const segments = splitKey(key);
        if (segments.length === 0) return undefined;
        let current: unknown = this.tree;
        for (const seg of segments) {
            if (!isPlainObject(current)) return undefined;
            if (!Object.prototype.hasOwnProperty.call(current, seg)) return undefined;
            current = current[seg];
        }
        return current as T;
    }

    public getValue(section?: string): unknown {
        if (section === undefined || section.length === 0) return this.tree;
        return this.get<unknown>(section);
    }

    /** Leaf dotted keys only. */
    public collectKeys(): string[] {
        const out: string[] = [];
        collectKeys(this.tree, "", out);
        return out;
    }
}

type ReadonlyTree = Readonly<Record<string, unknown>>;

/** Like vscode's `OVERRIDE_PROPERTY_REGEX`: `"[go]"`, combined `"[javascript][typescript]"`. */
const OVERRIDE_KEY = /^(\[[^\]]+\])+$/;

export function isOverrideKey(key: string): boolean {
    return OVERRIDE_KEY.test(key);
}

function overrideIdentifiersOf(key: string): string[] | null {
    if (!isOverrideKey(key)) return null;
    return key
        .slice(1, -1)
        .split("][")
        .map((identifier) => identifier.trim())
        .filter((identifier) => identifier.length > 0);
}

function splitKey(key: string): string[] {
    if (key.length === 0) return [];
    return key.split(".");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value) as object | null;
    return proto === null || proto === Object.prototype;
}

/**
 * Only **top-level** dotted keys are expanded, NOT those inside a value, like VS Code's
 * `toValuesTree`: otherwise `"files.watcherExclude": { ".git/objects/**": true }` would fall apart
 * into `{ "": { "git/objects/**": true } }`. A dot inside a value is not a path separator.
 */
function normalizeNode(raw: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
        const normalizedValue = value;
        if (key.includes(".")) {
            const segments = key.split(".");
            assignNested(result, segments, normalizedValue);
        } else {
            mergeAssign(result, key, normalizedValue);
        }
    }
    return result;
}

function assignNested(target: Record<string, unknown>, segments: readonly string[], value: unknown): void {
    let current = target;
    for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        const existing = current[seg];
        if (isPlainObject(existing)) {
            current = existing;
        } else {
            const next: Record<string, unknown> = {};
            current[seg] = next;
            current = next;
        }
    }
    const last = segments[segments.length - 1];
    mergeAssign(current, last, value);
}

function mergeAssign(target: Record<string, unknown>, key: string, value: unknown): void {
    const existing = target[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
        target[key] = deepMerge(existing, value);
    } else {
        target[key] = value;
    }
}

function deepMerge(a: ReadonlyTree, b: ReadonlyTree): Record<string, unknown> {
    const result: Record<string, unknown> = { ...a };
    for (const [key, value] of Object.entries(b)) {
        const existing = result[key];
        if (isPlainObject(existing) && isPlainObject(value)) {
            result[key] = deepMerge(existing, value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function collectKeys(node: unknown, prefix: string, out: string[]): void {
    if (!isPlainObject(node)) {
        /* v8 ignore start -- defensive: the top-level call always passes the (object) tree, so a non-object node is only ever reached during recursion with a non-empty prefix; the empty-prefix branch is unreachable */
        if (prefix.length > 0) out.push(prefix);
        /* v8 ignore stop */
        return;
    }
    for (const [key, value] of Object.entries(node)) {
        const next = prefix.length === 0 ? key : `${prefix}.${key}`;
        collectKeys(value, next, out);
    }
}
