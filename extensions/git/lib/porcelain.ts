export interface IPorcelainEntry {
    /** Relative to the repository root; the *new* path for renames/copies. */
    path: string;
    /** `X` = index, `Y` = working tree. */
    xy: string;
    /**
     * Second `-z` field of `R`/`C` records. In the reference `parseGitStatus` the
     * names are swapped: `rename` is the new path, `path` the old one.
     */
    originalPath?: string;
}

/** `git status --porcelain=v1 -z --untracked-files=all`. */
export function parsePorcelainStatus(buf: Buffer): IPorcelainEntry[] {
    const fields = splitNul(buf);
    const entries: IPorcelainEntry[] = [];

    let i = 0;
    while (i < fields.length) {
        const record = fields[i];
        const xy = record.slice(0, 2);
        // `XY<space>PATH`
        const entry: IPorcelainEntry = { path: record.slice(3), xy };
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
 * For a rename (`R` or intent-to-rename ` R`), the original path: the new one is empty
 * in HEAD, and the diff would show the whole file as added. Upstream doesn't use a copy (`C`)
 * as the left side (`getLeftResource` in `extensions/git/src/repository.ts`).
 */
export function pathAtHead(entry: IPorcelainEntry): string {
    if (entry.originalPath === undefined || !entry.xy.includes("R")) return entry.path;
    return entry.originalPath;
}

/** No trailing empty field. */
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
