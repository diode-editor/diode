/**
 * Минимальный semver для матчинга `engines` расширений против версии хоста.
 *
 * Осознанно НЕ полная реализация node-semver: поддержано ровно то, что
 * встречается в engines курируемого реестра — `*`, точная версия, `^x.y.z`,
 * `~x.y.z`, компараторы `>= > <= <` и их конъюнкция через пробел
 * (`>=1.2.0 <2.0.0`). Всё прочее (`||`, `1.2.x`, дефисные диапазоны,
 * `x`-плейсхолдеры) даёт `false` — реестр курируемый, мы контролируем,
 * какие диапазоны в него попадают. Тащить npm `semver` в SEA-бандл ради
 * этого подмножества избыточно.
 */

/** Разобранная версия `x.y.z(-prerelease)?`; build-метаданные (`+…`) отрезаются. */
export interface ISemver {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    /** Идентификаторы prerelease без ведущего дефиса (например `"beta.1"`), если есть. */
    readonly prerelease: string | undefined;
}

const SEMVER_RE =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Строгий парсинг `x.y.z(-pre)?(+build)?`; всё остальное → `undefined`. */
export function parseSemver(value: string): ISemver | undefined {
    const m = SEMVER_RE.exec(value.trim());
    if (m === null) return undefined;
    return {
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3]),
        prerelease: m[4],
    };
}

/**
 * Сравнение идентификаторов prerelease по правилам semver: по точкам,
 * числовые — численно и всегда меньше буквенных, меньший набор полей меньше.
 */
function comparePrerelease(a: string, b: string): number {
    const as = a.split(".");
    const bs = b.split(".");
    const len = Math.max(as.length, bs.length);
    for (let i = 0; i < len; i++) {
        // Индекс может выходить за длину меньшего массива; .at() честно
        // возвращает string | undefined.
        const ai = as.at(i);
        const bi = bs.at(i);
        if (ai === undefined) return -1;
        if (bi === undefined) return 1;
        const an = /^\d+$/.test(ai);
        const bn = /^\d+$/.test(bi);
        if (an && bn) {
            const av = Number(ai);
            const bv = Number(bi);
            if (av < bv) return -1;
            if (av > bv) return 1;
        } else if (an !== bn) {
            // Числовые идентификаторы всегда ниже буквенных.
            return an ? -1 : 1;
        } else if (ai < bi) {
            return -1;
        } else if (ai > bi) {
            return 1;
        }
    }
    return 0;
}

/** Полное сравнение версий; prerelease-версия меньше той же версии без prerelease. */
export function compareSemver(a: ISemver, b: ISemver): number {
    if (a.major < b.major) return -1;
    if (a.major > b.major) return 1;
    if (a.minor < b.minor) return -1;
    if (a.minor > b.minor) return 1;
    if (a.patch < b.patch) return -1;
    if (a.patch > b.patch) return 1;
    if (a.prerelease === undefined && b.prerelease === undefined) return 0;
    if (a.prerelease === undefined) return 1;
    if (b.prerelease === undefined) return -1;
    // comparePrerelease уже возвращает ровно -1/0/1, нормализация не нужна.
    return comparePrerelease(a.prerelease, b.prerelease);
}

/** Верхняя граница caret-диапазона: первая версия, которая уже НЕ входит в `^base`. */
function caretUpperBound(base: ISemver): ISemver {
    if (base.major > 0) return { major: base.major + 1, minor: 0, patch: 0, prerelease: undefined };
    if (base.minor > 0) return { major: 0, minor: base.minor + 1, patch: 0, prerelease: undefined };
    return { major: 0, minor: 0, patch: base.patch + 1, prerelease: undefined };
}

/** Известные операторы; порядок важен — двухсимвольные раньше своих префиксов. */
const COMPARATOR_OPERATORS = ["^", "~", ">=", "<=", ">", "<", "="] as const;

/** Проверка одного компаратора; неразбираемая форма → `false`. */
function satisfiesComparator(version: ISemver, comparator: string): boolean {
    const prefix = COMPARATOR_OPERATORS.find((op) => comparator.startsWith(op));
    const operator = prefix ?? "=";
    const base = parseSemver(prefix === undefined ? comparator : comparator.slice(prefix.length));
    if (base === undefined) return false;
    const cmp = compareSemver(version, base);
    switch (operator) {
        case "=":
            return cmp === 0;
        case ">=":
            return cmp >= 0;
        case ">":
            return cmp > 0;
        case "<=":
            return cmp <= 0;
        case "<":
            return cmp < 0;
        case "~":
            return (
                cmp >= 0 &&
                compareSemver(version, { major: base.major, minor: base.minor + 1, patch: 0, prerelease: undefined }) <
                    0
            );
        default:
            // "^"
            return cmp >= 0 && compareSemver(version, caretUpperBound(base)) < 0;
    }
}

/**
 * Удовлетворяет ли `version` диапазону `range`. Поддержано: `*`, точная версия,
 * `^x.y.z`, `~x.y.z`, `>= > <= <`, конъюнкция компараторов через пробел.
 * Неразбираемые версия или диапазон → `false`.
 */
export function satisfiesSemverRange(version: string, range: string): boolean {
    const parsed = parseSemver(version);
    if (parsed === undefined) return false;
    const trimmed = range.trim();
    if (trimmed === "*") return true;
    // Пустую строку отдельно отсекать не нужно: split даёт [""], а пустой
    // компаратор не парсится → false.
    return trimmed.split(/\s+/).every((comparator) => satisfiesComparator(parsed, comparator));
}
