import type { IAssetAccess } from "../../../base/common/assets/iAssetAccess.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

// Like upstream `localizeManifest`: one pass over the whole manifest tree, not just commands. Keys
// live in `displayName`, view titles and setting descriptions, and the extension itself sees the
// localized manifest as `packageJSON`. A missing key stays `%key%` and is logged; a broken bundle
// doesn't fail loading.

/** `Partial`: a lookup of a missing key must yield `undefined`. */
export type INlsBundle = Readonly<Partial<Record<string, string>>>;

const NLS_PREFIX = "package.nls";
const NLS_SUFFIX = ".json";

export const NLS_BASE_FILE = `${NLS_PREFIX}${NLS_SUFFIX}`;

/**
 * The locale, its base language (`pt-br` → `pt`), then `package.nls.json` last. For `en` there is
 * a single candidate: extensions don't ship `package.nls.en.json`.
 */
export function nlsFileCandidates(locale: string): readonly string[] {
    const normalized = locale.trim().toLowerCase();
    if (normalized === "" || normalized === "en") return [NLS_BASE_FILE];

    const candidates = [`${NLS_PREFIX}.${normalized}${NLS_SUFFIX}`];
    const dash = normalized.indexOf("-");
    const language = dash === -1 ? "" : normalized.slice(0, dash);
    if (language !== "" && language !== "en") candidates.push(`${NLS_PREFIX}.${language}${NLS_SUFFIX}`);
    candidates.push(NLS_BASE_FILE);
    return candidates;
}

/**
 * A non-string value counts as a missing key (and gets logged), not a silent `[object Object]`.
 * Throws on invalid JSON and on a non-object.
 */
export function parseNlsBundle(raw: string): INlsBundle {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("nls bundle must be a JSON object");
    }
    const bundle: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") bundle[key] = value;
    }
    return bundle;
}

/** `"%java.clean%"` → `java.clean`; `"%"` and `"%%"` are not keys. */
export function nlsKeyOf(value: string): string | undefined {
    if (value.length <= 2 || !value.startsWith("%") || !value.endsWith("%")) return undefined;
    return value.slice(1, -1);
}

export interface ILocalizeResult<T> {
    readonly value: T;
    /** Deduplicated, in traversal order. */
    readonly unresolved: readonly string[];
}

/** Returns a new tree; the source manifest is not mutated. */
export function localizeManifest<T>(manifest: T, bundle: INlsBundle | undefined): ILocalizeResult<T> {
    const unresolved: string[] = [];
    return { value: localizeNode(manifest, bundle, unresolved) as T, unresolved };
}

function localizeNode(node: unknown, bundle: INlsBundle | undefined, unresolved: string[]): unknown {
    if (typeof node === "string") {
        const key = nlsKeyOf(node);
        if (key === undefined) return node;
        const translated = bundle?.[key];
        if (translated === undefined) {
            if (!unresolved.includes(key)) unresolved.push(key);
            return node;
        }
        return translated;
    }
    if (Array.isArray(node)) return node.map((item) => localizeNode(item, bundle, unresolved));
    if (typeof node === "object" && node !== null) {
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(node)) result[key] = localizeNode(item, bundle, unresolved);
        return result;
    }
    return node;
}

/**
 * Goes through {@link IAssetAccess}, not `fs`: builtin extensions live in the SEA bundle.
 * On a broken locale bundle the next candidate is taken.
 */
export async function loadNlsBundle(
    assets: IAssetAccess,
    extensionPrefix: string,
    locale: string,
    logger?: ILogger,
): Promise<INlsBundle | undefined> {
    for (const file of nlsFileCandidates(locale)) {
        const assetPath = `${extensionPrefix}${file}`;
        if (!(await assets.exists(assetPath))) continue;
        try {
            return parseNlsBundle(await assets.readText(assetPath));
        } catch (err) {
            logger?.error(`Failed to read nls bundle ${assetPath}`, err);
        }
    }
    return undefined;
}

/** Missing keys go to the log as one line: a line per key would be 30 lines for `redhat.java`. */
export async function localizeExtensionManifest<T>(
    manifest: T,
    assets: IAssetAccess,
    extensionPrefix: string,
    locale: string,
    logger?: ILogger,
): Promise<T> {
    const bundle = await loadNlsBundle(assets, extensionPrefix, locale, logger);
    const { value, unresolved } = localizeManifest(manifest, bundle);
    if (unresolved.length > 0) {
        logger?.warn(`${extensionPrefix}: unresolved nls keys (${unresolved.length}): ${unresolved.join(", ")}`);
    }
    return value;
}
