export interface ILogRef {
    /** Short name: `main`, `origin/main`, `v1.0`. */
    readonly name: string;
    readonly kind: "head" | "remote" | "tag";
    /** `HEAD -> main`. */
    readonly current: boolean;
}

export interface ILogEntry {
    readonly sha: string;
    readonly shortSha: string;
    /** In git order; empty for a root commit. */
    readonly parents: readonly string[];
    readonly refs: readonly ILogRef[];
    readonly author: string;
    /** Unix seconds (`%at`). */
    readonly timestamp: number;
    readonly subject: string;
}

/**
 * Records and fields are NUL-separated: a commit message can't contain NUL, so
 * split needs no escaping. The graph layout relies on `--topo-order`
 * (children above parents).
 */
export const LOG_FORMAT_ARGS = ["-z", "--topo-order", "--format=%H%x00%h%x00%P%x00%D%x00%an%x00%at%x00%s"] as const;

const FIELDS_PER_ENTRY = 7;

/** An incomplete chunk (truncated output) is dropped rather than becoming a garbage record. */
export function parseLogZ(stdout: string): ILogEntry[] {
    const fields = stdout.split("\0");
    // The trailing NUL leaves an empty tail that breaks the field count; a real empty
    // subject keeps the count and doesn't hit this condition.
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
 * `HEAD -> main, origin/main, tag: v1.0`. A bare `HEAD` (detached) is not a ref;
 * `origin/HEAD` is a pointer, useless in badges (as in vscode).
 */
export function parseDecorations(raw: string): ILogRef[] {
    const refs: ILogRef[] = [];
    for (const chunk of raw.split(", ")) {
        const token = chunk.trim();
        if (token === "" || token === "HEAD") continue;

        // Check the prefix without the trailing space: the ", " separator eats
        // it from a `tag: ` token with an empty name.
        if (token.startsWith("tag:")) {
            const name = token.slice("tag:".length).trim();
            if (name !== "") refs.push({ name, kind: "tag", current: false });
            continue;
        }

        const current = token.startsWith("HEAD -> ");
        const name = current ? token.slice("HEAD -> ".length) : token;
        // `%D` prints short names: only a remote branch has a slash.
        const kind = !current && name.includes("/") ? "remote" : "head";
        if (kind === "remote" && name.endsWith("/HEAD")) continue;
        refs.push({ name, kind, current });
    }
    return refs;
}
