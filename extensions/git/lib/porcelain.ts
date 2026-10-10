/** One entry of `git status --porcelain=v1`. */
export interface IPorcelainEntry {
    /** Path relative to the repository root (the *new* path for renames/copies). */
    path: string;
    /** The two-character `XY` status code (`X` = index, `Y` = working tree). */
    xy: string;
    /**
     * Исходный путь переименования/копирования (`R`/`C` в `XY`) — второе поле
     * записи `-z`; у остальных записей поля нет. Это `rename` из
     * `parseGitStatus` эталона (там имена наоборот: `rename` — новый путь,
     * `path` — старый).
     */
    originalPath?: string;
}

/**
 * Parse the output of `git status --porcelain=v1 -z --untracked-files=all`.
 *
 * The `-z` form is NUL-terminated (no quoting, raw bytes) with records shaped
 * `XY<space>PATH`. Rename/copy records (`R`/`C` in `XY`) carry a *second*
 * NUL-terminated field — the original path — right after the record; we consume
 * it so it is not mistaken for a standalone entry, report the new path as `path`
 * and keep the old one as `originalPath`.
 */
export function parsePorcelainStatus(buf: Buffer): IPorcelainEntry[] {
    const fields = splitNul(buf);
    const entries: IPorcelainEntry[] = [];

    let i = 0;
    while (i < fields.length) {
        const record = fields[i];
        const xy = record.slice(0, 2);
        // record is `XY<space>PATH`; the path starts after the single separating space.
        const entry: IPorcelainEntry = { path: record.slice(3), xy };
        // Rename/copy records are followed by the original path in the next field.
        if (hasOriginalPath(xy)) {
            const original = fields.at(i + 1);
            if (original !== undefined) entry.originalPath = original;
            i += 2;
        } else {
            i += 1;
        }
        entries.push(entry);
    }

    return entries;
}

/**
 * Путь файла в HEAD — с ним сравнивается рабочая версия. У переименования
 * (`R` в индексе или intent-to-rename ` R` в рабочем дереве) это исходный
 * путь: по новому в HEAD ничего нет, и дифф показал бы весь файл добавленным.
 * Эталон — `getLeftResource` в `extensions/git/src/repository.ts`: для
 * `INDEX_RENAMED`/`INTENT_TO_RENAME` левая сторона — `HEAD` от
 * `resource.original`. Копия (`C`) — не переименование: исходник в HEAD живёт
 * своей жизнью, и левой стороной эталон его не берёт.
 */
export function pathAtHead(entry: IPorcelainEntry): string {
    if (entry.originalPath === undefined || !entry.xy.includes("R")) return entry.path;
    return entry.originalPath;
}

/** Split a NUL-terminated buffer into UTF-8 fields (no trailing empty field). */
function splitNul(buf: Buffer): string[] {
    const fields: string[] = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0) {
            fields.push(buf.toString("utf8", start, i));
            start = i + 1;
        }
    }
    if (start < buf.length) fields.push(buf.toString("utf8", start));
    return fields;
}

function hasOriginalPath(xy: string): boolean {
    return xy.includes("R") || xy.includes("C");
}
