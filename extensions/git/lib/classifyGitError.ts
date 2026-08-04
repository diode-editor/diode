/** Классы ошибок git — зеркало `GitErrorKind` протокола (по мотивам GitErrorCodes VS Code). */
export type GitErrorKind =
    | "auth"
    | "conflict"
    | "dirty-worktree"
    | "push-rejected"
    | "no-upstream"
    | "not-merged"
    | "unavailable"
    | "git-error";

const AUTH_PATTERNS = [
    "terminal prompts disabled",
    "Authentication failed",
    "could not read Username",
    "could not read Password",
    "Permission denied (publickey)",
    "Host key verification failed",
];

/**
 * Классифицирует stderr неуспешного git-вызова. Порядок важен: auth-паттерны
 * специфичнее generic «[rejected]», конфликт — раньше dirty-worktree (оба
 * упоминают merge).
 */
export function classifyGitStderr(stderr: string): GitErrorKind {
    if (AUTH_PATTERNS.some((p) => stderr.includes(p))) return "auth";
    if (stderr.includes("CONFLICT (") || stderr.includes("Automatic merge failed") || stderr.includes("could not apply")) {
        return "conflict";
    }
    if (stderr.includes("would be overwritten")) return "dirty-worktree";
    if (stderr.includes("[rejected]") || stderr.includes("failed to push some refs")) return "push-rejected";
    if (stderr.includes("has no upstream branch")) return "no-upstream";
    if (stderr.includes("is not fully merged")) return "not-merged";
    return "git-error";
}
