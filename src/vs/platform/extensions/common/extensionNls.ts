import type { IAssetAccess } from "../../../base/common/assets/iAssetAccess.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

/**
 * Локализация манифеста расширения (`package.json` → `package.nls[.<locale>].json`).
 *
 * Расширения не пишут в манифест готовые строки: вместо заголовка команды там
 * стоит ключ `"%java.server.mode.switch%"`, а человеческий текст лежит рядом в
 * `package.nls.json` (и в `package.nls.<locale>.json` для переводов). Пока
 * резолва не было, в палитре висел сам ключ — ровно это видел пользователь на
 * стоковом `redhat.java`.
 *
 * Как в эталоне (`localizeManifest` в upstream), подмена делается **одним
 * проходом по всему дереву манифеста**, а не точечно у команд: те же ключи
 * сидят в `displayName`/`description`, в заголовках view, в `label` тем и в
 * описаниях настроек. Манифест целиком уезжает в регистрацию расширения и
 * становится его `packageJSON` в `vscode.extensions` — то есть локализованным
 * его видит и само расширение, что эталону соответствует.
 *
 * Краевые случаи — эталонные:
 *   - ключа нет ни в одном бандле → строка остаётся как есть (`%key%`) и
 *     попадает в одну строку лога (молча подставить пустоту = отлаживать
 *     нечем);
 *   - нет/битый `package.nls.json` → расширение грузится с нерезолвленными
 *     строками, загрузка не падает;
 *   - значение, которое само не строка, не трогаем.
 */

/**
 * Разобранный nls-бандл: ключ → строка. `Partial`, потому что ключи
 * произвольные — обращение по отсутствующему ключу обязано давать `undefined`.
 */
export type INlsBundle = Readonly<Partial<Record<string, string>>>;

const NLS_PREFIX = "package.nls";
const NLS_SUFFIX = ".json";

/** `package.nls.json` — бандл исходного (английского) текста манифеста. */
export const NLS_BASE_FILE = `${NLS_PREFIX}${NLS_SUFFIX}`;

/**
 * Имена nls-файлов в порядке приоритета для локали: сперва сама локаль, затем
 * её базовый язык (`pt-br` → `pt`), в хвосте всегда `package.nls.json`.
 *
 * Для `en` (и пустой строки) кандидат один: `package.nls.json` и ЕСТЬ
 * английский бандл, `package.nls.en.json` расширения не кладут.
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
 * Разбирает содержимое nls-файла. Нестроковые значения отбрасывает: ключ с
 * таким значением считается ненайденным, то есть строка манифеста останется
 * ключом и попадёт в лог — в отличие от молчаливой подстановки `[object Object]`.
 *
 * Бросает на невалидном JSON и на верхнем уровне, который не объект (массив,
 * число, `null`): вызывающий решает, что с этим делать.
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

/**
 * Имя ключа локализации, если строка им является: `"%java.clean%"` → `java.clean`.
 * Иначе `undefined` — это обычный текст манифеста.
 *
 * Ключ обязан быть непустым, поэтому `"%"` и `"%%"` ключами не считаются и
 * остаются в манифесте как есть.
 */
export function nlsKeyOf(value: string): string | undefined {
    if (value.length <= 2 || !value.startsWith("%") || !value.endsWith("%")) return undefined;
    return value.slice(1, -1);
}

/** Результат локализации: значение + ключи, для которых перевода не нашлось. */
export interface ILocalizeResult<T> {
    readonly value: T;
    /** Ненайденные ключи без дублей, в порядке обхода. Строки оставлены как есть. */
    readonly unresolved: readonly string[];
}

/**
 * Резолвит `%ключи%` во всём дереве манифеста (объекты, массивы, строки) и
 * возвращает НОВОЕ дерево — исходный манифест не мутируется.
 */
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
 * Читает nls-бандл расширения через {@link IAssetAccess} — а не через `fs`:
 * builtin-расширения живут внутри SEA-бандла, где файла на диске нет вовсе.
 * Кандидаты перебираются в порядке {@link nlsFileCandidates}; битый бандл
 * локали не отменяет локализацию целиком — берётся следующий кандидат (в
 * хвосте всегда база). Не нашлось ни одного — `undefined`.
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

/**
 * Полный путь локализации одного расширения: читает бандл по локали и резолвит
 * манифест. Ненайденные ключи — ОДНОЙ строкой в лог на расширение (по строке на
 * ключ было бы 30 строк на одном `redhat.java`).
 */
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
