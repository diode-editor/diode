/** Один ref из `git for-each-ref` — материал для пикеров checkout/merge/pull-from. */
export interface IGitRef {
    /** Короткое имя: `main`, `origin/main`, `v1.0`. */
    readonly name: string;
    readonly kind: "head" | "remote" | "tag";
    readonly sha: string;
    readonly subject: string;
}

/** Формат-аргумент для {@link parseForEachRefZ} (NUL-разделители внутри строки). */
export const FOR_EACH_REF_FORMAT = "%(refname)%00%(objectname:short)%00%(subject)";

/** Разбирает `git for-each-ref --format=FOR_EACH_REF_FORMAT` (строка на ref). */
export function parseForEachRefZ(stdout: string): IGitRef[] {
    const refs: IGitRef[] = [];
    for (const line of stdout.split("\n")) {
        if (line === "") continue;
        const fields = line.split("\0");
        const refname = fields.at(0);
        const sha = fields.at(1);
        const subject = fields.at(2);
        if (refname === undefined || sha === undefined) continue;
        let kind: IGitRef["kind"];
        let name: string;
        if (refname.startsWith("refs/heads/")) {
            kind = "head";
            name = refname.slice("refs/heads/".length);
        } else if (refname.startsWith("refs/remotes/")) {
            kind = "remote";
            name = refname.slice("refs/remotes/".length);
        } else if (refname.startsWith("refs/tags/")) {
            kind = "tag";
            name = refname.slice("refs/tags/".length);
        } else {
            continue;
        }
        // `origin/HEAD` — симлинк-указатель, в пикерах бесполезен.
        if (kind === "remote" && name.endsWith("/HEAD")) continue;
        refs.push({ name, kind, sha, subject: subject ?? "" });
    }
    return refs;
}

/** Один стэш из `git stash list`. */
export interface IGitStash {
    /** `stash@{0}` — аргумент для pop/apply/drop. */
    readonly index: string;
    readonly description: string;
}

/** Формат-аргумент для {@link parseStashListZ}. */
export const STASH_LIST_FORMAT = "%gd%x00%gs";

/** Разбирает `git stash list --format=STASH_LIST_FORMAT`. */
export function parseStashListZ(stdout: string): IGitStash[] {
    const stashes: IGitStash[] = [];
    for (const line of stdout.split("\n")) {
        if (line === "") continue;
        const fields = line.split("\0");
        const index = fields.at(0);
        const description = fields.at(1);
        if (!index?.startsWith("stash@{")) continue;
        stashes.push({ index, description: description ?? "" });
    }
    return stashes;
}
