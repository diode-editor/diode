import { safeRefArg } from "./syncArgs.ts";

/** Same order as in the core picker. */
export const RESET_MODES = ["soft", "mixed", "hard"] as const;

export type ResetMode = (typeof RESET_MODES)[number];

/** The mode comes only from an allowlist: it crosses the process boundary and must not be glued to `--`. */
export function resetArgs(params: Record<string, unknown>): string[] | null {
    const ref = safeRefArg(params.ref);
    const mode = params.mode;
    if (ref === null || typeof mode !== "string") return null;
    if (!(RESET_MODES as readonly string[]).includes(mode)) return null;
    return ["reset", `--${mode}`, ref];
}

/** `--no-edit` is required: the subprocess has no editor, so git would hang on the message. */
export function revertArgs(params: Record<string, unknown>): string[] | null {
    const ref = safeRefArg(params.ref);
    return ref === null ? null : ["revert", "--no-edit", ref];
}
