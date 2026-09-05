import semver from "semver";

/**
 * Формат данных реестра расширений (публикуемый вид registry-репозитория).
 *
 * Каталог реестра:
 * ```
 * <root>/index.json          — компактный список для поиска и Extensions view
 * <root>/meta/<id>.json      — полная мета расширения, читается лениво
 * <root>/artifacts/**        — .vsix для path-артефактов (файловый source/тесты)
 * ```
 *
 * Этот модуль — source of truth типов формата: типы и парсеры переживут
 * файловый источник и будут переиспользованы HTTP-источником и CI-тулингом
 * registry-репозитория. Философия валидации — как у `scanExtensions`: битая
 * ЗАПИСЬ (расширение в index, версия в meta) пропускается с диагностикой в
 * `problems`, битый ФАЙЛ целиком (не JSON, чужой schemaVersion, id ≠
 * publisher.name) — ошибка. Модуль чистый: диагностики логирует вызывающий.
 */

/** Текущая версия схемы. Опциональные поля добавляются без bump'а. */
export const REGISTRY_SCHEMA_VERSION = 1;

/**
 * Форма id `publisher.name`. Id участвует в адресе меты (`meta/<id>.json`) — и как
 * имя файла у файлового источника, и как сегмент URL у HTTP-источника, — поэтому
 * шаблон проверяется до обращения к источнику. Регистр допускается: манифесты
 * стоковых расширений пишем не мы (`EditorConfig.EditorConfig`), а `installFromRegistry`
 * сверяет id с манифестом побайтно.
 */
export const EXTENSION_ID_RE = /^[a-z0-9][a-z0-9_-]*\.[a-z0-9][a-z0-9_-]*$/i;

/**
 * Курационная классификация: `proxy-openvsx` — протестированный нами сток из
 * openvsx (версия запинена URL + sha256), `native` — нативное diode-расширение.
 * В install-флоу не участвует — нужна странице расширения и политике наполнения.
 */
export type RegistryExtensionKind = "proxy-openvsx" | "native";

/** Откуда берётся `.vsix` версии. `origin` — provenance для UI/аудита, поведение клиента от него не зависит. */
export type RegistryArtifact =
    | { readonly type: "url"; readonly url: string; readonly origin?: "openvsx" | "github-release" }
    /** POSIX-путь строго внутри каталога реестра (без `..` и ведущего `/`). */
    | { readonly type: "path"; readonly path: string };

/** Требования совместимости версии; хотя бы одно из полей обязано присутствовать. */
export interface IRegistryEngines {
    readonly diode?: string;
    readonly vscode?: string;
}

/** Одна опубликованная версия расширения. */
export interface IRegistryVersion {
    readonly version: string;
    readonly engines: IRegistryEngines;
    readonly artifact: RegistryArtifact;
    /** sha256 содержимого `.vsix`, hex lowercase — проверяется перед установкой. */
    readonly sha256: string;
    /** Размер `.vsix` в байтах (информационное, для UI). */
    readonly size?: number;
    /** ISO-дата публикации (информационное). */
    readonly publishedAt?: string;
}

/** Запись `index.json` — всё, что нужно списку/поиску без ленивого чтения меты. */
export interface IRegistryIndexEntry {
    /** Строго `${publisher}.${name}`. */
    readonly id: string;
    readonly publisher: string;
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    readonly kind: RegistryExtensionKind;
    /** Категории из словаря VS Code (опционально). */
    readonly categories?: readonly string[];
    /** Последняя версия — чтобы view показывал версию и совместимость сразу. */
    readonly latest: { readonly version: string; readonly engines: IRegistryEngines };
}

export interface IRegistryIndex {
    readonly schemaVersion: number;
    /** Момент сборки индекса CI (информационное, клиент не интерпретирует). */
    readonly generatedAt?: string;
    readonly extensions: readonly IRegistryIndexEntry[];
}

/** `meta/<id>.json` — полная мета расширения (страница расширения + установка). */
export interface IRegistryExtensionMeta {
    readonly schemaVersion: number;
    readonly id: string;
    readonly publisher: string;
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    readonly kind: RegistryExtensionKind;
    readonly repository?: string;
    readonly license?: string;
    readonly homepage?: string;
    /** Inline markdown для страницы расширения в табе. */
    readonly readme?: string;
    readonly versions: readonly IRegistryVersion[];
}

const SHA256_RE = /^[0-9a-f]{64}$/;

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function isKind(value: unknown): value is RegistryExtensionKind {
    return value === "proxy-openvsx" || value === "native";
}

/** Валидирует engines: объект хотя бы с одним из полей `diode`/`vscode`-строк. */
function parseEngines(value: unknown): IRegistryEngines | undefined {
    const record = asRecord(value);
    if (record === undefined) return undefined;
    const diode = record["diode"];
    const vscode = record["vscode"];
    if (diode !== undefined && !isNonEmptyString(diode)) return undefined;
    if (vscode !== undefined && !isNonEmptyString(vscode)) return undefined;
    if (diode === undefined && vscode === undefined) return undefined;
    return { diode, vscode };
}

/** Относительный POSIX-путь строго внутри корня: без `\`, ведущего `/` и `..`-сегментов. */
function isSafeRelativePath(value: string): boolean {
    if (value.includes("\\")) return false;
    // Ведущий "/" отдельно не проверяем: он даёт пустой первый сегмент, который отсекает every ниже.
    return value.split("/").every((segment) => segment.length > 0 && segment !== "..");
}

function parseArtifact(value: unknown): RegistryArtifact | undefined {
    const record = asRecord(value);
    if (record === undefined) return undefined;
    if (record["type"] === "url") {
        const url = record["url"];
        const origin = record["origin"];
        if (!isNonEmptyString(url)) return undefined;
        if (origin !== undefined && origin !== "openvsx" && origin !== "github-release") return undefined;
        return { type: "url", url, origin };
    }
    if (record["type"] === "path") {
        const relPath = record["path"];
        if (!isNonEmptyString(relPath) || !isSafeRelativePath(relPath)) return undefined;
        return { type: "path", path: relPath };
    }
    return undefined;
}

/** Разбирает запись версии; невалидная → `undefined` (в `problems` пишет вызывающий). */
function parseVersionRecord(value: unknown): IRegistryVersion | undefined {
    const record = asRecord(value);
    if (record === undefined) return undefined;
    const version = record["version"];
    if (!isNonEmptyString(version) || semver.valid(version) === null) return undefined;
    const engines = parseEngines(record["engines"]);
    if (engines === undefined) return undefined;
    const artifact = parseArtifact(record["artifact"]);
    if (artifact === undefined) return undefined;
    const sha256 = record["sha256"];
    if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) return undefined;
    const size = record["size"];
    if (size !== undefined && typeof size !== "number") return undefined;
    const publishedAt = record["publishedAt"];
    if (publishedAt !== undefined && !isNonEmptyString(publishedAt)) return undefined;
    return { version, engines, artifact, sha256, size, publishedAt };
}

/** Общие для index-записи и меты поля идентичности; `undefined` при любой невалидности. */
function parseIdentity(
    record: Record<string, unknown>,
): { id: string; publisher: string; name: string; displayName: string; description: string; kind: RegistryExtensionKind } | undefined {
    const { publisher, name, displayName, description, kind } = record;
    if (
        !isNonEmptyString(publisher) ||
        !isNonEmptyString(name) ||
        !isNonEmptyString(displayName) ||
        typeof description !== "string" ||
        !isKind(kind)
    ) {
        return undefined;
    }
    // Отдельно валидировать record["id"] как непустую строку избыточно: строгое равенство
    // непустому шаблону `${publisher}.${name}` уже гарантирует и тип, и непустоту.
    const id = `${publisher}.${name}`;
    if (record["id"] !== id) return undefined;
    return { id, publisher, name, displayName, description, kind };
}

/** Разбирает JSON-текст файла и валидирует конверт (объект + schemaVersion). */
function parseEnvelope(text: string, what: string): Record<string, unknown> {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error(`Invalid registry ${what}: malformed JSON`);
    }
    const record = asRecord(raw);
    if (record === undefined) {
        throw new Error(`Invalid registry ${what}: expected a JSON object`);
    }
    const schemaVersion = record["schemaVersion"];
    if (typeof schemaVersion !== "number") {
        throw new Error(`Invalid registry ${what}: missing "schemaVersion"`);
    }
    if (schemaVersion > REGISTRY_SCHEMA_VERSION) {
        throw new Error(
            `Registry ${what} has schemaVersion ${String(schemaVersion)}, but this client supports up to ${String(REGISTRY_SCHEMA_VERSION)} — update Diode`,
        );
    }
    return record;
}

function parseIndexEntry(value: unknown): IRegistryIndexEntry | undefined {
    const record = asRecord(value);
    if (record === undefined) return undefined;
    const identity = parseIdentity(record);
    if (identity === undefined) return undefined;
    const categories = record["categories"];
    if (categories !== undefined && (!Array.isArray(categories) || !categories.every(isNonEmptyString))) {
        return undefined;
    }
    const latestRecord = asRecord(record["latest"]);
    if (latestRecord === undefined) return undefined;
    const latestVersion = latestRecord["version"];
    if (!isNonEmptyString(latestVersion) || semver.valid(latestVersion) === null) return undefined;
    const latestEngines = parseEngines(latestRecord["engines"]);
    if (latestEngines === undefined) return undefined;
    return {
        ...identity,
        categories: categories as readonly string[] | undefined,
        latest: { version: latestVersion, engines: latestEngines },
    };
}

/**
 * Разбирает `index.json`. Битый файл (не JSON, чужой schemaVersion, extensions
 * не массив) — ошибка; битая запись расширения — пропуск с текстом в `problems`.
 */
export function parseRegistryIndex(text: string): { index: IRegistryIndex; problems: string[] } {
    const record = parseEnvelope(text, "index");
    const rawExtensions = record["extensions"];
    if (!Array.isArray(rawExtensions)) {
        throw new Error('Invalid registry index: missing "extensions" array');
    }
    const generatedAt = record["generatedAt"];
    const problems: string[] = [];
    const extensions: IRegistryIndexEntry[] = [];
    for (const [i, raw] of rawExtensions.entries()) {
        const entry = parseIndexEntry(raw);
        if (entry === undefined) {
            const id = asRecord(raw)?.["id"];
            problems.push(`registry index: skipping invalid entry #${String(i)}${isNonEmptyString(id) ? ` (${id})` : ""}`);
            continue;
        }
        extensions.push(entry);
    }
    return {
        index: {
            schemaVersion: record["schemaVersion"] as number,
            generatedAt: isNonEmptyString(generatedAt) ? generatedAt : undefined,
            extensions,
        },
        problems,
    };
}

/**
 * Разбирает `meta/<id>.json`. Битый файл (не JSON, чужой schemaVersion,
 * невалидная идентичность, id ≠ `expectedId`) — ошибка; битая запись версии —
 * пропуск с текстом в `problems`.
 */
export function parseRegistryMeta(
    text: string,
    expectedId?: string,
): { meta: IRegistryExtensionMeta; problems: string[] } {
    const record = parseEnvelope(text, "meta");
    const identity = parseIdentity(record);
    if (identity === undefined) {
        throw new Error("Invalid registry meta: bad identity fields (id/publisher/name/displayName/description/kind)");
    }
    if (expectedId !== undefined && identity.id !== expectedId) {
        throw new Error(`Invalid registry meta: id "${identity.id}" does not match expected "${expectedId}"`);
    }
    const rawVersions = record["versions"];
    if (!Array.isArray(rawVersions)) {
        throw new Error('Invalid registry meta: missing "versions" array');
    }
    const optional = (field: string): string | undefined => {
        const value = record[field];
        return isNonEmptyString(value) ? value : undefined;
    };
    const problems: string[] = [];
    const versions: IRegistryVersion[] = [];
    for (const [i, raw] of rawVersions.entries()) {
        const version = parseVersionRecord(raw);
        if (version === undefined) {
            const v = asRecord(raw)?.["version"];
            problems.push(
                `registry meta ${identity.id}: skipping invalid version #${String(i)}${isNonEmptyString(v) ? ` (${v})` : ""}`,
            );
            continue;
        }
        versions.push(version);
    }
    return {
        meta: {
            schemaVersion: record["schemaVersion"] as number,
            ...identity,
            repository: optional("repository"),
            license: optional("license"),
            homepage: optional("homepage"),
            readme: optional("readme"),
            versions,
        },
        problems,
    };
}

/**
 * Поиск по индексу: case-insensitive substring по id/displayName/description.
 * Пустой (или пробельный) запрос — весь список. Используется CLI и Extensions view.
 */
export function searchRegistryIndex(index: IRegistryIndex, query: string): IRegistryIndexEntry[] {
    const needle = query.trim().toLowerCase();
    // Пустой needle отдельно не обрабатываем: substring-поиск пустой строки истинен для любой
    // записи, так что filter сам вернёт полный (и новый) список.
    return index.extensions.filter(
        (e) =>
            e.id.toLowerCase().includes(needle) ||
            e.displayName.toLowerCase().includes(needle) ||
            e.description.toLowerCase().includes(needle),
    );
}
