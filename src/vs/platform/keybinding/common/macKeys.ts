/**
 * Клавиатурная лестница мака — второе семейство рунгов рядом с `tier`.
 *
 * `tier` (`legacy < csi-u < kitty`) — про способности терминала вообще; на маке
 * решающая способность другая: доезжает ли super (Cmd), и ломает её не tier, а
 * tmux (у него три модификатора, Cmd и Option сливаются в один бит). Поэтому
 * мак резолвится отдельно и в `tier` не засовывается: «мак» не мощнее «pc».
 *
 * Рунги — надмножества друг друга, отсюда наследование вверх: комбинацию
 * объявляют на самом низком рунге, где она физически возможна.
 *  - legacy:   ни Ctrl+Shift, ни Cmd (Terminal.app; tmux с дефолтным `extended-keys off`);
 *  - extended: Ctrl+Shift, Ctrl+Tab, Shift+Enter — Cmd нет (tmux с `extended-keys always`);
 *  - cmd:      плюс Cmd (kitty / ghostty / iTerm2 без tmux).
 *
 * В when-клаузах рунг — числовой контекст-ключ `macKeys` (иначе «≥» не
 * выразить); 0 — клавиатура не маковская. Авторы биндов пишут не строку, а
 * типизированный хелпер: рунг чужого семейства (`"kitty"`) — ошибка типа.
 */

/** Рунг мак-лестницы, слабый → сильный. */
export type MacKeysRung = "legacy" | "extended" | "cmd";

export const MAC_KEYS_RUNGS: readonly MacKeysRung[] = ["legacy", "extended", "cmd"];

/** Имя числового контекст-ключа. */
export const MAC_KEYS_CONTEXT_KEY = "macKeys";

/** Значение `macKeys` на не-маковской клавиатуре. */
export const MAC_KEYS_NONE = 0;

/**
 * Числовое значение рунга для контекст-ключа: 1…3. Ноль занят «не мак» — и
 * это же значение получает неустановленный ключ (`false >= 1` ложно), так что
 * мак-бинд не оживёт в контексте, где окружение ещё не выставлено.
 */
export function macKeysLevel(rung: MacKeysRung | undefined): number {
    return rung === undefined ? MAC_KEYS_NONE : MAC_KEYS_RUNGS.indexOf(rung) + 1;
}

/** when: маковская клавиатура на рунге `rung` или выше. */
export function macKeysAtLeast(rung: MacKeysRung): string {
    return `${MAC_KEYS_CONTEXT_KEY} >= ${String(macKeysLevel(rung))}`;
}

/** when: маковская клавиатура ровно на рунге `rung`. */
export function macKeysIs(rung: MacKeysRung): string {
    return `${MAC_KEYS_CONTEXT_KEY} == ${String(macKeysLevel(rung))}`;
}

/** when: клавиатура не маковская (pc-раскладка). */
export function notMacKeys(): string {
    return `${MAC_KEYS_CONTEXT_KEY} < 1`;
}

/** when: маковская клавиатура ниже рунга `rung` либо не мак вовсе. */
export function macKeysBelow(rung: MacKeysRung): string {
    return `${MAC_KEYS_CONTEXT_KEY} < ${String(macKeysLevel(rung))}`;
}
