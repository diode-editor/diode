// Mirrors `extensions/git/lib/protocol.ts` by value: no imports across the process boundary.
export const GIT_OP_COMMAND = "diode.git.op";

export type GitErrorKind =
    | "auth"
    | "conflict"
    | "dirty-worktree"
    | "push-rejected"
    | "no-upstream"
    | "not-merged"
    | "unavailable"
    | "git-error";

export type GitOpResult =
    | { readonly ok: true; readonly data?: Readonly<Record<string, unknown>> }
    | { readonly ok: false; readonly kind: GitErrorKind; readonly message: string; readonly stderr?: string };

export function parseGitOpResult(raw: unknown): GitOpResult | null {
    if (typeof raw !== "object" || raw === null) return null;
    const { ok } = raw as { ok?: unknown };
    if (ok === true) {
        const { data } = raw as { data?: unknown };
        if (data !== undefined && (typeof data !== "object" || data === null)) return null;
        return raw as GitOpResult;
    }
    if (ok === false) {
        const { kind, message } = raw as { kind?: unknown; message?: unknown };
        if (typeof kind !== "string" || typeof message !== "string") return null;
        return raw as GitOpResult;
    }
    return null;
}
