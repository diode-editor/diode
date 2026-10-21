// Мак-лестница — отдельно от `tier`: решает, доезжает ли Cmd, а ломает это tmux (Cmd и Option
// сливаются в один бит), поэтому «мак» не мощнее «pc». Рунги — надмножества: комбинацию
// объявляют на самом низком, где она физически возможна.
//  - legacy:   ни Ctrl+Shift, ни Cmd (Terminal.app; tmux с дефолтным `extended-keys off`);
//  - extended: Ctrl+Shift, Ctrl+Tab, Shift+Enter — Cmd нет (tmux с `extended-keys always`);
//  - cmd:      плюс Cmd (kitty / ghostty / iTerm2 без tmux).
// В when рунг — числовой ключ `macKeys`: иначе «≥» не выразить.

/** Слабый → сильный. */
export type MacKeysRung = "legacy" | "extended" | "cmd";

export const MAC_KEYS_RUNGS: readonly MacKeysRung[] = ["legacy", "extended", "cmd"];

export const MAC_KEYS_CONTEXT_KEY = "macKeys";

export const MAC_KEYS_NONE = 0;

/** 1…3; 0 — «не мак», его же даёт неустановленный ключ (`false >= 1` ложно): мак-бинд не оживёт до выставления окружения. */
export function macKeysLevel(rung: MacKeysRung | undefined): number {
    // Stryker disable next-line ConditionalExpression: indexOf(undefined) + 1 тоже даёт 0 — эквивалентный мутант; явная ветка — для читателя и типов.
    return rung === undefined ? MAC_KEYS_NONE : MAC_KEYS_RUNGS.indexOf(rung) + 1;
}

export function macKeysAtLeast(rung: MacKeysRung): string {
    return `${MAC_KEYS_CONTEXT_KEY} >= ${String(macKeysLevel(rung))}`;
}

/** when: маковская клавиатура ровно на рунге `rung`. */
export function macKeysIs(rung: MacKeysRung): string {
    return `${MAC_KEYS_CONTEXT_KEY} == ${String(macKeysLevel(rung))}`;
}

/** when: клавиатура не маковская (pc-раскладка). */
export function notMacKeys(): string {
    return `!(${MAC_KEYS_CONTEXT_KEY} >= 1)`;
}

/**
 * when: маковская клавиатура ниже рунга `rung` либо не мак вовсе.
 *
 * «Ниже» записано отрицанием «не ниже», а не через `<`: при незаданном ключе
 * (контекст до старта окружения, свежий контекст в тестах) `macKeys < 3` по
 * грамматике when ложно — `parseFloat(undefined)` даёт NaN, — а pc-бинд должен
 * действовать. `!(macKeys >= 3)` истинно и тогда.
 */
export function macKeysBelow(rung: MacKeysRung): string {
    return `!(${MAC_KEYS_CONTEXT_KEY} >= ${String(macKeysLevel(rung))})`;
}
