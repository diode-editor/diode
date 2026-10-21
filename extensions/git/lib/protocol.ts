/**
 * The types are mirrored by value in `src/vs/workbench/contrib/scm/common/gitProtocol.ts`:
 * no shared imports across the process boundary. Not a generic exec: the extension builds argv.
 */
export const GIT_OP_COMMAND = "diode.git.op";

export interface IGitOpRequest {
    readonly op: string;
    /** Validated by the extension. */
    readonly params?: Readonly<Record<string, unknown>>;
}

/** Modeled on VS Code GitErrorCodes. */
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
