import type { Semver } from "../../../base/common/semver.ts";

/**
 * Extension registry data format (the published form of the registry repository).
 *
 * Registry layout:
 * ```
 * <root>/index.json          — compact list for search and the Extensions view
 * <root>/meta/<id>.json      — full extension meta, read lazily
 * <root>/artifacts/**        — .vsix for path artifacts (file source/tests)
 * ```
 *
 * Validation follows `scanExtensions`: a broken RECORD (an extension in index, a
 * version in meta) is skipped with a diagnostic in `problems`; a broken FILE is an error.
 *
 * node-semver is a lazy chunk, so parsers receive it as a parameter.
 */

/** Optional fields are added without a bump. */
export const REGISTRY_SCHEMA_VERSION = 1;

/**
 * The id is the meta file name and URL segment, so the pattern is checked before
 * hitting the source. Uppercase is allowed: we don't write stock extension manifests
 * (`EditorConfig.EditorConfig`), and `installFromRegistry` compares ids byte for byte.
 */
export const EXTENSION_ID_RE = /^[a-z0-9][a-z0-9_-]*\.[a-z0-9][a-z0-9_-]*$/i;

/**
 * `proxy-openvsx` is a stock extension from openvsx (pinned URL + sha256),
 * `proxy-hosted` is a stock extension missing from Open VSX, its vsix re-hosted in
 * the registry. Not used by the install flow.
 */
export type RegistryExtensionKind = "proxy-openvsx" | "proxy-hosted" | "native";

/** Set by the registry, not the manifest; doesn't affect install, only warns the user BEFORE it. */
export type RegistrySupportLevel = "full" | "partial";

/** The parser drops `partial` without `limits` items: "not everything works" must say what doesn't. */
export interface IRegistrySupport {
    readonly level: RegistrySupportLevel;
    readonly works?: readonly string[];
    readonly limits?: readonly string[];
}

/** Where the version's `.vsix` comes from. `origin` is provenance for UI/audit; client behavior doesn't depend on it. */
export type RegistryArtifact =
    | { readonly type: "url"; readonly url: string; readonly origin?: "openvsx" | "github-release" }
    /** POSIX path strictly inside the registry directory (no `..` or leading `/`). */
    | { readonly type: "path"; readonly path: string };

/** At least one field must be present. */
export interface IRegistryEngines {
    readonly diode?: string;
    readonly vscode?: string;
}

export interface IRegistryVersion {
    readonly version: string;
    readonly engines: IRegistryEngines;
    readonly artifact: RegistryArtifact;
    /** hex lowercase. */
    readonly sha256: string;
    /**
     * Unset means universal. One semver version may come as several records with
     * different targets. Deliberately not checked against the target vocabulary: the
     * registry may be ahead of the client, and an unknown target simply won't match.
     */
    readonly targetPlatform?: string;
    readonly size?: number;
    readonly publishedAt?: string;
}

export interface IRegistryIndexEntry {
    readonly id: string;
    readonly publisher: string;
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    readonly kind: RegistryExtensionKind;
    readonly categories?: readonly string[];
    /** In the index too, not just the meta: the list badge must be visible before install. */
    readonly support?: IRegistrySupport;
    readonly latest: { readonly version: string; readonly engines: IRegistryEngines };
}

export interface IRegistryIndex {
    readonly schemaVersion: number;
    readonly generatedAt?: string;
    readonly extensions: readonly IRegistryIndexEntry[];
}

export interface IRegistryExtensionMeta {
    readonly schemaVersion: number;
    readonly id: string;
    readonly publisher: string;
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    readonly kind: RegistryExtensionKind;
    readonly support?: IRegistrySupport;
    readonly repository?: string;
    readonly license?: string;
    readonly homepage?: string;
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
    return value === "proxy-openvsx" || value === "proxy-hosted" || value === "native";
}

function parseEngines(value: unknown): IRegistryEngines | undefined {
    const record = asRecord(value);
    if (record === undefined) return undefined;
    const diode = record.diode;
    const vscode = record.vscode;
    if (diode !== undefined && !isNonEmptyString(diode)) return undefined;
    if (vscode !== undefined && !isNonEmptyString(vscode)) return undefined;
    if (diode === undefined && vscode === undefined) return undefined;
    return { diode, vscode };
}

/** `null` means a broken field. */
function parseBulletList(value: unknown): readonly string[] | undefined | null {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || !value.every(isNonEmptyString)) return null;
    return value;
}

/**
 * Cosmetic field: a broken value is silently dropped and the record survives;
 * otherwise `problems` would fill up with things that don't affect install.
 */
function parseSupport(value: unknown): IRegistrySupport | undefined {
    const record = asRecord(value);
    if (record === undefined) return undefined;
    const level = record.level;
    if (level !== "full" && level !== "partial") return undefined;
    const works = parseBulletList(record.works);
    const limits = parseBulletList(record.limits);
    if (works === null || limits === null) return undefined;
    if (level === "partial" && (limits === undefined || limits.length === 0)) return undefined;
    return { level, works, limits };
}

function isSafeRelativePath(value: string): boolean {
    if (value.includes("\\")) return false;
    // No separate leading "/" check: it yields an empty first segment, which `every` below rejects.
    return value.split("/").every((segment) => segment.length > 0 && segment !== "..");
}

function parseArtifact(value: unknown): RegistryArtifact | undefined {
    const record = asRecord(value);
    if (record === undefined) return undefined;
    if (record.type === "url") {
        const url = record.url;
        const origin = record.origin;
        if (!isNonEmptyString(url)) return undefined;
        if (origin !== undefined && origin !== "openvsx" && origin !== "github-release") return undefined;
        return { type: "url", url, origin };
    }
    if (record.type === "path") {
        const relPath = record.path;
        if (!isNonEmptyString(relPath) || !isSafeRelativePath(relPath)) return undefined;
        return { type: "path", path: relPath };
    }
    return undefined;
}

function parseVersionRecord(value: unknown, semver: Semver): IRegistryVersion | undefined {
    const record = asRecord(value);
    if (record === undefined) return undefined;
    const version = record.version;
    if (!isNonEmptyString(version) || semver.valid(version) === null) return undefined;
    const engines = parseEngines(record.engines);
    if (engines === undefined) return undefined;
    const artifact = parseArtifact(record.artifact);
    if (artifact === undefined) return undefined;
    const sha256 = record.sha256;
    if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) return undefined;
    const targetPlatform = record.targetPlatform;
    if (targetPlatform !== undefined && !isNonEmptyString(targetPlatform)) return undefined;
    const size = record.size;
    if (size !== undefined && typeof size !== "number") return undefined;
    const publishedAt = record.publishedAt;
    if (publishedAt !== undefined && !isNonEmptyString(publishedAt)) return undefined;
    return { version, engines, artifact, sha256, targetPlatform, size, publishedAt };
}

function parseIdentity(record: Record<string, unknown>):
    | {
          id: string;
          publisher: string;
          name: string;
          displayName: string;
          description: string;
          kind: RegistryExtensionKind;
      }
    | undefined {
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
    // Strict equality to a non-empty template already checks both the type and non-emptiness of `record.id`.
    const id = `${publisher}.${name}`;
    if (record.id !== id) return undefined;
    return { id, publisher, name, displayName, description, kind };
}

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
    const schemaVersion = record.schemaVersion;
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

function parseIndexEntry(value: unknown, semver: Semver): IRegistryIndexEntry | undefined {
    const record = asRecord(value);
    if (record === undefined) return undefined;
    const identity = parseIdentity(record);
    if (identity === undefined) return undefined;
    const categories = record.categories;
    if (categories !== undefined && (!Array.isArray(categories) || !categories.every(isNonEmptyString))) {
        return undefined;
    }
    const latestRecord = asRecord(record.latest);
    if (latestRecord === undefined) return undefined;
    const latestVersion = latestRecord.version;
    if (!isNonEmptyString(latestVersion) || semver.valid(latestVersion) === null) return undefined;
    const latestEngines = parseEngines(latestRecord.engines);
    if (latestEngines === undefined) return undefined;
    return {
        ...identity,
        categories: categories as readonly string[] | undefined,
        support: parseSupport(record.support),
        latest: { version: latestVersion, engines: latestEngines },
    };
}

export function parseRegistryIndex(text: string, semver: Semver): { index: IRegistryIndex; problems: string[] } {
    const record = parseEnvelope(text, "index");
    const rawExtensions = record.extensions;
    if (!Array.isArray(rawExtensions)) {
        throw new Error('Invalid registry index: missing "extensions" array');
    }
    const generatedAt = record.generatedAt;
    const problems: string[] = [];
    const extensions: IRegistryIndexEntry[] = [];
    for (const [i, raw] of rawExtensions.entries()) {
        const entry = parseIndexEntry(raw, semver);
        if (entry === undefined) {
            const id = asRecord(raw)?.id;
            problems.push(
                `registry index: skipping invalid entry #${String(i)}${isNonEmptyString(id) ? ` (${id})` : ""}`,
            );
            continue;
        }
        extensions.push(entry);
    }
    return {
        index: {
            schemaVersion: record.schemaVersion as number,
            generatedAt: isNonEmptyString(generatedAt) ? generatedAt : undefined,
            extensions,
        },
        problems,
    };
}

export function parseRegistryMeta(
    text: string,
    semver: Semver,
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
    const rawVersions = record.versions;
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
        const version = parseVersionRecord(raw, semver);
        if (version === undefined) {
            const v = asRecord(raw)?.version;
            problems.push(
                `registry meta ${identity.id}: skipping invalid version #${String(i)}${isNonEmptyString(v) ? ` (${v})` : ""}`,
            );
            continue;
        }
        versions.push(version);
    }
    return {
        meta: {
            schemaVersion: record.schemaVersion as number,
            ...identity,
            support: parseSupport(record.support),
            repository: optional("repository"),
            license: optional("license"),
            homepage: optional("homepage"),
            readme: optional("readme"),
            versions,
        },
        problems,
    };
}

export interface IExtensionSearchFields {
    readonly id: string;
    readonly displayName: string;
    readonly description: string;
}

export function normalizeExtensionQuery(query: string): string {
    return query.trim().toLowerCase();
}

/**
 * `needle` is already passed through {@link normalizeExtensionQuery}. Separate from
 * {@link searchRegistryIndex}: the Extensions view filters its own cards (which include
 * installed extensions missing from the index), and search semantics must be shared.
 */
export function matchesExtensionQuery(entry: IExtensionSearchFields, needle: string): boolean {
    return (
        entry.id.toLowerCase().includes(needle) ||
        entry.displayName.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle)
    );
}

export function searchRegistryIndex(index: IRegistryIndex, query: string): IRegistryIndexEntry[] {
    const needle = normalizeExtensionQuery(query);
    return index.extensions.filter((e) => matchesExtensionQuery(e, needle));
}
