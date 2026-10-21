export interface ILogRef {
    /** Короткое имя: `main`, `origin/main`, `v1.0`. */
    readonly name: string;
    readonly kind: "head" | "remote" | "tag";
    /** `HEAD -> main`. */
    readonly current: boolean;
}

export interface ILogEntry {
    readonly sha: string;
    readonly shortSha: string;
    /** В порядке git; пусто — корневой коммит. */
    readonly parents: readonly string[];
    readonly refs: readonly ILogRef[];
    readonly author: string;
    /** Unix-секунды (`%at`). */
    readonly timestamp: number;
    readonly subject: string;
}

/**
 * Записи и поля разделены NUL — в сообщении коммита его быть не может, поэтому
 * split без экранирования. Укладка графа рассчитывает на `--topo-order`
 * (потомки выше родителей).
 */
export const LOG_FORMAT_ARGS = ["-z", "--topo-order", "--format=%H%x00%h%x00%P%x00%D%x00%an%x00%at%x00%s"] as const;

const FIELDS_PER_ENTRY = 7;

/** Неполный чанк (обрезанный вывод) отбрасывается, а не становится мусорной записью. */
export function parseLogZ(stdout: string): ILogEntry[] {
    const fields = stdout.split("\0");
    // Завершающий NUL даёт пустой хвост, ломающий кратность; настоящий пустой
    // subject кратность сохраняет и под это условие не попадает.
    if (fields.length % FIELDS_PER_ENTRY === 1 && fields[fields.length - 1] === "") {
        fields.pop();
    }
    const entries: ILogEntry[] = [];
    for (let i = 0; i + FIELDS_PER_ENTRY <= fields.length; i += FIELDS_PER_ENTRY) {
        const [sha, shortSha, parents, decorations, author, timestamp, subject] = fields.slice(i, i + FIELDS_PER_ENTRY);
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

function parseParents(raw: string): string[] {
    return raw.split(" ").filter((sha) => sha !== "");
}

/**
 * `HEAD -> main, origin/main, tag: v1.0`. Голый `HEAD` (detached) — не ref;
 * `origin/HEAD` — указатель, в бейджах бесполезен (как и в vscode).
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
        // `%D` печатает короткие имена: слэш есть только у remote-ветки.
        const kind = !current && name.includes("/") ? "remote" : "head";
        if (kind === "remote" && name.endsWith("/HEAD")) continue;
        refs.push({ name, kind, current });
    }
    return refs;
}
