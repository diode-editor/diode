import { safeRefArg } from "./syncArgs.ts";

/** Режимы `git reset`, которые предлагает граф (порядок — как в пикере ядра). */
export const RESET_MODES = ["soft", "mixed", "hard"] as const;

export type ResetMode = (typeof RESET_MODES)[number];

/**
 * `git reset --soft|--mixed|--hard <ref>`. Режим — только из белого списка:
 * значение приходит из-за границы процесса и склеивать его с `--` нельзя.
 */
export function resetArgs(params: Record<string, unknown>): string[] | null {
    const ref = safeRefArg(params.ref);
    const mode = params.mode;
    if (ref === null || typeof mode !== "string") return null;
    if (!(RESET_MODES as readonly string[]).includes(mode)) return null;
    return ["reset", `--${mode}`, ref];
}

/**
 * `git revert --no-edit <ref>` — обратный коммит поверх HEAD. `--no-edit`
 * обязателен: редактора у субпроцесса нет, иначе git повиснет на сообщении.
 */
export function revertArgs(params: Record<string, unknown>): string[] | null {
    const ref = safeRefArg(params.ref);
    return ref === null ? null : ["revert", "--no-edit", ref];
}
