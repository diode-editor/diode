/**
 * Зеркало типов — в `src/vs/workbench/contrib/scm/common/gitProtocol.ts`, по значению:
 * общих импортов через границу процесса нет. Не generic-exec: argv собирает расширение.
 */
export const GIT_OP_COMMAND = "diode.git.op";

export interface IGitOpRequest {
    readonly op: string;
    /** Валидирует расширение. */
    readonly params?: Readonly<Record<string, unknown>>;
}

/** По мотивам GitErrorCodes VS Code. */
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

export interface IGitCommitParams {
    readonly message: string;
    readonly amend: boolean;
    readonly all: boolean;
    readonly noVerify: boolean;
    readonly allowEmpty: boolean;
}
