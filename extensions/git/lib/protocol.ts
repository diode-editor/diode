/**
 * Протокол диспетчера git-операций `diode.git.op` (расширение ↔ ядро). Ядро
 * держит зеркало типов в `src/vs/workbench/contrib/scm/common/gitProtocol.ts` —
 * по значению, без общих импортов через границу процесса (конвенция
 * PUBLISH_CHANGES_COMMAND).
 *
 * Семантический диспетчер, а не generic-exec: argv собирает расширение
 * (владение repoRoot/env/классификацией ошибок), ядро оперирует операциями.
 */
export const GIT_OP_COMMAND = "diode.git.op";

/** Запрос операции: имя + типизированные параметры (валидирует расширение). */
export interface IGitOpRequest {
    readonly op: string;
    readonly params?: Readonly<Record<string, unknown>>;
}

/** Классы ошибок по exit code + паттернам stderr (по мотивам GitErrorCodes VS Code). */
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

/** Параметры операции `commit`. */
export interface IGitCommitParams {
    readonly message: string;
    readonly amend: boolean;
    readonly all: boolean;
    readonly noVerify: boolean;
    readonly allowEmpty: boolean;
}
