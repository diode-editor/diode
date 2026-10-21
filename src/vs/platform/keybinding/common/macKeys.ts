// The mac ladder is separate from `tier`: it decides whether Cmd gets through, and tmux breaks that
// (Cmd and Option merge into one bit), so "mac" is not stronger than "pc". Rungs are supersets: a chord
// is declared on the lowest rung where it is physically possible.
//  - legacy:   neither Ctrl+Shift nor Cmd (Terminal.app; tmux with the default `extended-keys off`);
//  - extended: Ctrl+Shift, Ctrl+Tab, Shift+Enter, no Cmd (tmux with `extended-keys always`);
//  - cmd:      plus Cmd (kitty / ghostty / iTerm2 without tmux).
// In `when` the rung is the numeric key `macKeys`: otherwise "≥" can't be expressed.

/** Weak → strong. */
export type MacKeysRung = "legacy" | "extended" | "cmd";

export const MAC_KEYS_RUNGS: readonly MacKeysRung[] = ["legacy", "extended", "cmd"];

export const MAC_KEYS_CONTEXT_KEY = "macKeys";

export const MAC_KEYS_NONE = 0;

/** 1…3; 0 is "not mac", as is an unset key (`false >= 1` is false): a mac binding stays dead until the environment is set. */
export function macKeysLevel(rung: MacKeysRung | undefined): number {
    // Stryker disable next-line ConditionalExpression: indexOf(undefined) + 1 also yields 0, an equivalent mutant; the explicit branch is for the reader and the types.
    return rung === undefined ? MAC_KEYS_NONE : MAC_KEYS_RUNGS.indexOf(rung) + 1;
}

export function macKeysAtLeast(rung: MacKeysRung): string {
    return `${MAC_KEYS_CONTEXT_KEY} >= ${String(macKeysLevel(rung))}`;
}

/** when: a mac keyboard exactly at rung `rung`. */
export function macKeysIs(rung: MacKeysRung): string {
    return `${MAC_KEYS_CONTEXT_KEY} == ${String(macKeysLevel(rung))}`;
}

/** when: the keyboard is not a mac one (pc layout). */
export function notMacKeys(): string {
    return `!(${MAC_KEYS_CONTEXT_KEY} >= 1)`;
}

/**
 * when: a mac keyboard below rung `rung`, or not mac at all.
 *
 * "Below" is written as the negation of "not below" rather than with `<`: with the key
 * unset (context before the environment starts, a fresh context in tests) `macKeys < 3`
 * is false by the when grammar (`parseFloat(undefined)` yields NaN), yet a pc binding
 * must apply. `!(macKeys >= 3)` is true even then.
 */
export function macKeysBelow(rung: MacKeysRung): string {
    return `!(${MAC_KEYS_CONTEXT_KEY} >= ${String(macKeysLevel(rung))})`;
}
