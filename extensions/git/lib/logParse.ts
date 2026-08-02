/** Запись `git log` для публикации ядру (view Graph). */
export interface ILogEntry {
    readonly sha: string;
    readonly shortSha: string;
    readonly subject: string;
}

/**
 * Формат для {@link parseLogZ}: и поля записи, и сами записи разделены NUL
 * (`-z` + `%x00` между полями) — сообщение коммита NUL содержать не может,
 * поэтому разбор — плоский split без экранирования.
 */
export const LOG_FORMAT_ARGS = ["-z", "--format=%H%x00%h%x00%s"] as const;

/**
 * Разбирает вывод `git log -z --format=%H%x00%h%x00%s`: плоский NUL-разделённый
 * поток чанками по три поля (sha, короткий sha, subject). Хвостовой пустой
 * элемент от завершающего NUL отбрасывается; неполный чанк (обрезанный вывод)
 * тоже отбрасывается, а не превращается в мусорную запись.
 */
export function parseLogZ(stdout: string): ILogEntry[] {
    const fields = stdout.split("\0");
    // Завершающий NUL даёт пустой хвост, ломающий кратность трём; настоящий
    // пустой subject кратность сохраняет и под это условие не попадает.
    if (fields.length % 3 === 1 && fields[fields.length - 1] === "") {
        fields.pop();
    }
    const entries: ILogEntry[] = [];
    for (let i = 0; i + 3 <= fields.length; i += 3) {
        const [sha, shortSha, subject] = [fields[i], fields[i + 1], fields[i + 2]];
        if (sha === "") continue;
        entries.push({ sha, shortSha, subject });
    }
    return entries;
}
