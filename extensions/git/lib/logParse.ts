/** Ссылка, указывающая на коммит (`%D`) — бейдж в графе. */
export interface ILogRef {
    /** Короткое имя: `main`, `origin/main`, `v1.0`. */
    readonly name: string;
    readonly kind: "head" | "remote" | "tag";
    /** Ветка, на которой стоит HEAD (`HEAD -> main`). */
    readonly current: boolean;
}

/** Запись `git log` для публикации ядру (view Graph). */
export interface ILogEntry {
    readonly sha: string;
    readonly shortSha: string;
    /** Родители в порядке git; пусто — корневой коммит. */
    readonly parents: readonly string[];
    readonly refs: readonly ILogRef[];
    readonly author: string;
    /** Время коммита, unix-секунды (`%at`). */
    readonly timestamp: number;
    readonly subject: string;
}

/**
 * Формат для {@link parseLogZ}: и поля записи, и сами записи разделены NUL
 * (`-z` + `%x00` между полями) — сообщение коммита NUL содержать не может,
 * поэтому разбор — плоский split без экранирования. `--topo-order` держит
 * потомков выше родителей: укладка графа рассчитывает именно на это.
 */
export const LOG_FORMAT_ARGS = ["-z", "--topo-order", "--format=%H%x00%h%x00%P%x00%D%x00%an%x00%at%x00%s"] as const;

/** Сколько полей в одной записи формата выше. */
const FIELDS_PER_ENTRY = 7;

/**
 * Разбирает вывод `git log` в формате {@link LOG_FORMAT_ARGS}: плоский
 * NUL-разделённый поток чанками по семь полей. Хвостовой пустой элемент от
 * завершающего NUL отбрасывается; неполный чанк (обрезанный вывод) тоже
 * отбрасывается, а не превращается в мусорную запись.
 */
export function parseLogZ(stdout: string): ILogEntry[] {
    const fields = stdout.split("\0");
    // Завершающий NUL даёт пустой хвост, ломающий кратность; настоящий пустой
    // subject кратность сохраняет и под это условие не попадает.
    if (fields.length % FIELDS_PER_ENTRY === 1 && fields[fields.length - 1] === "") {
        fields.pop();
    }
    const entries: ILogEntry[] = [];
    for (let i = 0; i + FIELDS_PER_ENTRY <= fields.length; i += FIELDS_PER_ENTRY) {
        const [sha, shortSha, parents, decorations, author, timestamp, subject] = fields.slice(
            i,
            i + FIELDS_PER_ENTRY,
        );
        if (sha === "") continue;
        entries.push({
            sha,
            shortSha,
            parents: parseParents(parents),
            refs: parseDecorations(decorations),
            author,
            timestamp: Number.parseInt(timestamp, 10) || 0,
            subject,
        });
    }
    return entries;
}

/** `%P` — родители через пробел; у корневого коммита поле пустое. */
function parseParents(raw: string): string[] {
    return raw.split(" ").filter((sha) => sha !== "");
}

/**
 * `%D` — декорации коммита: `HEAD -> main, origin/main, tag: v1.0`. Голый
 * `HEAD` (detached) ref'ом не считаем — ветки за ним нет; `origin/HEAD` —
 * симлинк-указатель, в бейджах бесполезен (как и в vscode).
 */
export function parseDecorations(raw: string): ILogRef[] {
    const refs: ILogRef[] = [];
    for (const chunk of raw.split(", ")) {
        const token = chunk.trim();
        if (token === "" || token === "HEAD") continue;

        // Префикс проверяем без хвостового пробела: разделитель ", " съедает
        // его у токена вида `tag: ` с пустым именем.
        if (token.startsWith("tag:")) {
            const name = token.slice("tag:".length).trim();
            if (name !== "") refs.push({ name, kind: "tag", current: false });
            continue;
        }

        const current = token.startsWith("HEAD -> ");
        const name = current ? token.slice("HEAD -> ".length) : token;
        if (name === "") continue;
        // Remote-ветку от локальной отличаем по слэшу: `%D` печатает короткие
        // имена, и `origin/main` — единственная форма с разделителем.
        const kind = !current && name.includes("/") ? "remote" : "head";
        if (kind === "remote" && name.endsWith("/HEAD")) continue;
        refs.push({ name, kind, current });
    }
    return refs;
}
