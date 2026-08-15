/**
 * Зеркало протокола диспетчера git-операций (`extensions/git/lib/protocol.ts`) —
 * по значению, без общих импортов через границу процесса (конвенция
 * PUBLISH_CHANGES_COMMAND).
 */
export const GIT_OP_COMMAND = "diode.git.op";

/** Классы ошибок git-операций (по мотивам GitErrorCodes VS Code). */
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

/** Валидация envelope из-за границы процесса: всё непохожее — null. */
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
