/**
 * Иммутабельная модель одного слоя настроек или результата слияния.
 *
 * Внутри — глубоко вложенный объект, нормализованный к одной форме:
 * любые ключи с точками (`"editor.tabSize": 2`) при создании
 * разворачиваются в `{ editor: { tabSize: 2 } }`. Лукапы по точечному
 * ключу просто идут по вложенной структуре.
 *
 * Слияние: глубоко по объектам, для примитивов/массивов выигрывает
 * правый операнд (последующий слой). Это совпадает с поведением VS Code:
 * массивы не конкатенируются, объекты сливаются рекурсивно.
 *
 * Секции языков (`"[go]": { "editor.insertSpaces": false }`, в том числе
 * сдвоенные `"[javascript][typescript]"`) хранятся отдельно от основного дерева
 * — как `overrides` у `ConfigurationModel` vscode — и сливаются послойно так же.
 * Значение для языка даёт {@link override}: основное дерево, поверх — секция
 * языка. Применяется к уже слитой модели всех слоёв, поэтому `[lang]` из
 * любого слоя (и из дефолтов расширения) бьёт плоское значение любого слоя.
 */
export class ConfigurationModel {
    public static readonly EMPTY = new ConfigurationModel({}, new Map());

    private readonly tree: ReadonlyTree;
    private readonly overrides: ReadonlyMap<string, ReadonlyTree>;

    private constructor(tree: ReadonlyTree, overrides: ReadonlyMap<string, ReadonlyTree>) {
        this.tree = tree;
        this.overrides = overrides;
    }

    /**
     * Создаёт модель из произвольного результата `JSON.parse`. Не-объекты
     * (включая `null`, массивы и примитивы на верхнем уровне) трактуются
     * как «пусто» — для слоя настроек это всегда корневой объект.
     */
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
            // Секция языка — объект настроек; иное (опечатка) игнорируется.
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

    /** Идентификаторы языков, у которых в модели есть своя секция. */
    public getOverrideIdentifiers(): string[] {
        return [...this.overrides.keys()];
    }

    /** Секция языка как самостоятельная модель (без основного дерева); пустая, если секции нет. */
    public getOverride(identifier: string): ConfigurationModel {
        const section = this.overrides.get(identifier);
        return section === undefined ? ConfigurationModel.EMPTY : new ConfigurationModel(section, new Map());
    }

    /**
     * Модель для языка: основное дерево, поверх — секция `identifier` (аналог
     * `ConfigurationModel.override` vscode). Без секции — та же модель.
     */
    public override(identifier: string): ConfigurationModel {
        const section = this.overrides.get(identifier);
        if (section === undefined) return this;
        return new ConfigurationModel(deepMerge(this.tree, section), new Map());
    }

    /**
     * Сырая форма слоя: основное дерево плюс секции `"[lang]"` — то, что едет в
     * extension host и разбирается там тем же {@link fromRaw}.
     */
    public toRaw(): Record<string, unknown> {
        const raw: Record<string, unknown> = { ...this.tree };
        for (const [identifier, section] of this.overrides) raw[`[${identifier}]`] = section;
        return raw;
    }

    /** Точечный лукап. */
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

    /** Возвращает корень (без аргумента) или поддерево по dotted-section. */
    public getValue(section?: string): unknown {
        if (section === undefined || section.length === 0) return this.tree;
        return this.get<unknown>(section);
    }

    /** Плоский список всех «листовых» dotted-ключей. Используется для diff. */
    public collectKeys(): string[] {
        const out: string[] = [];
        collectKeys(this.tree, "", out);
        return out;
    }
}

type ReadonlyTree = Readonly<Record<string, unknown>>;

/** `"[go]"` → `["go"]`, `"[javascript][typescript]"` → оба; обычный ключ → `null`. */
const OVERRIDE_KEY = /^(\[[^\]]+\])+$/;

/** Ключ секции языка (`"[go]"`, `"[a][b]"`) — как `OVERRIDE_PROPERTY_REGEX` vscode. */
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
 * Разворачивает dotted-ключи **верхнего уровня** слоя в вложенные объекты.
 * При коллизии «строковый ключ + объект» побеждает позднее объявленный
 * (последовательность ключей в объекте, как и в JSON, неупорядочена —
 * поведение задокументировано, рассчитывать на порядок нельзя).
 *
 * Вглубь значения нормализация НЕ идёт — ровно как `toValuesTree` в VS Code.
 * Иначе map-настройки, у которых ключ сам по себе данные, разваливались бы:
 * `"files.watcherExclude": { ".git/objects/**": true }` превратился бы в
 * `{ "": { "git/objects/**": true } }`, а `files.associations` — в мусор на
 * каждом `*.ext`. Точка внутри значения — это точка, а не разделитель пути.
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
