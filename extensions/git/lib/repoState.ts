/** Payload `diode.scm.publishRepoState`. */
export interface IRepoStatePayload {
    /** null for a detached or unborn HEAD. */
    readonly branch: string | null;
    readonly detached: boolean;
    /** `origin/main`; null when not set. */
    readonly upstream: string | null;
    readonly ahead: number;
    readonly behind: number;
    readonly remotes: readonly string[];
    readonly state: "idle" | "merging" | "rebasing" | "cherry-picking";
}

/** `git status --porcelain=v2 --branch` headers; missing ones get defaults (unborn/no upstream). */
export function parseBranchHeaders(stdout: string): {
    branch: string | null;
    detached: boolean;
    upstream: string | null;
    ahead: number;
    behind: number;
} {
    let branch: string | null = null;
    let detached = false;
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;

    for (const line of stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) {
            const head = line.slice("# branch.head ".length).trim();
            if (head === "(detached)") {
                detached = true;
            } else if (head !== "") {
                branch = head;
            }
        } else if (line.startsWith("# branch.upstream ")) {
            const value = line.slice("# branch.upstream ".length).trim();
            if (value !== "") upstream = value;
        } else if (line.startsWith("# branch.ab ")) {
            const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line.trim());
            if (match !== null) {
                ahead = Number(match[1]);
                behind = Number(match[2]);
            }
        }
    }
    return { branch, detached, upstream, ahead, behind };
}

export function parseRemotes(stdout: string): string[] {
    return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
}
