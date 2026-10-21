import type { IAssetAccess } from "../../../base/common/assets/iAssetAccess.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

// Как `localizeManifest` эталона — одним проходом по всему дереву манифеста, а
// не точечно у команд: ключи сидят и в `displayName`, и в заголовках view, и в
// описаниях настроек, а локализованный манифест видит и само расширение как
// `packageJSON`. Ненайденный ключ остаётся `%key%` и уходит в лог; битый бандл
// загрузку не роняет.

/** `Partial`: обращение по отсутствующему ключу обязано давать `undefined`. */
export type INlsBundle = Readonly<Partial<Record<string, string>>>;

const NLS_PREFIX = "package.nls";
const NLS_SUFFIX = ".json";

export const NLS_BASE_FILE = `${NLS_PREFIX}${NLS_SUFFIX}`;

/**
 * Локаль, её базовый язык (`pt-br` → `pt`), в хвосте `package.nls.json`. Для
 * `en` кандидат один: `package.nls.en.json` расширения не кладут.
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
 * Нестроковое значение — ключ не найден (попадёт в лог), а не молчаливый
 * `[object Object]`. Бросает на невалидном JSON и не-объекте.
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

/** `"%java.clean%"` → `java.clean`; `"%"` и `"%%"` — не ключи. */
export function nlsKeyOf(value: string): string | undefined {
    if (value.length <= 2 || !value.startsWith("%") || !value.endsWith("%")) return undefined;
    return value.slice(1, -1);
}

export interface ILocalizeResult<T> {
    readonly value: T;
    /** Без дублей, в порядке обхода. */
    readonly unresolved: readonly string[];
}

/** Возвращает новое дерево, исходный манифест не мутируется. */
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
 * Через {@link IAssetAccess}, а не `fs`: builtin-расширения живут в SEA-бандле.
 * Битый бандл локали — берётся следующий кандидат.
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

/** Ненайденные ключи — одной строкой в лог: по строке на ключ было бы 30 строк на `redhat.java`. */
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
