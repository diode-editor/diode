export interface IGitRef {
    /** Short name: `main`, `origin/main`, `v1.0`. */
    readonly name: string;
    readonly kind: "head" | "remote" | "tag";
    readonly sha: string;
    readonly subject: string;
}

export const FOR_EACH_REF_FORMAT = "%(refname)%00%(objectname:short)%00%(subject)";

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
        // `origin/HEAD` is a symbolic pointer, useless in pickers.
        if (kind === "remote" && name.endsWith("/HEAD")) continue;
        refs.push({ name, kind, sha, subject: subject ?? "" });
    }
    return refs;
}

export interface IGitStash {
    /** `stash@{0}`, the argument for pop/apply/drop. */
    readonly index: string;
    readonly description: string;
}

export const STASH_LIST_FORMAT = "%gd%x00%gs";

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
