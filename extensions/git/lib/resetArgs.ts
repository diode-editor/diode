import { safeRefArg } from "./syncArgs.ts";

/** Порядок — как в пикере ядра. */
export const RESET_MODES = ["soft", "mixed", "hard"] as const;

export type ResetMode = (typeof RESET_MODES)[number];

/** Режим — только из белого списка: приходит из-за границы процесса, склеивать с `--` нельзя. */
export function resetArgs(params: Record<string, unknown>): string[] | null {
    const ref = safeRefArg(params.ref);
    const mode = params.mode;
    if (ref === null || typeof mode !== "string") return null;
    if (!(RESET_MODES as readonly string[]).includes(mode)) return null;
    return ["reset", `--${mode}`, ref];
}

/** `--no-edit` обязателен: редактора у субпроцесса нет, git повис бы на сообщении. */
export function revertArgs(params: Record<string, unknown>): string[] | null {
    const ref = safeRefArg(params.ref);
    return ref === null ? null : ["revert", "--no-edit", ref];
}
