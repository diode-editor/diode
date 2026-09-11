import type { IKeybindingEntrySnapshot } from "./keybindingRegistry.ts";
import { serializeChord } from "./keybindingRegistry.ts";

/**
 * Конфликт-детекция биндингов для вкладки Keyboard Shortcuts: записи с одной
 * комбинацией и потенциально пересекающимся when. Резолвер конфликтов не
 * знает — побеждает последняя зарегистрированная; здесь только подсветка,
 * чтобы «почему не работает мой бинд» было видно глазами.
 */

/**
 * Может ли пара when-выражений быть истинной одновременно. Честное пересечение
 * произвольных выражений — SAT-задача; принятое упрощение: отсутствующий when
 * пересекается с любым, непустые сравниваются нормализованной строкой (трим).
 * Ложноотрицательные возможны (`tier == 'kitty'` против `tier != 'legacy'` —
 * пересекаются, а мы скажем «нет») — это фильтр-помощник, не гарантия.
 */
export function whenMayOverlap(a: string | undefined, b: string | undefined): boolean {
    if (a === undefined || b === undefined) return true;
    return a.trim() === b.trim();
}

/**
 * Индексы записей `entries`, у которых есть конфликтующая пара: та же
 * комбинация (точное равенство чордов — chord-префиксы вроде `ctrl+k` против
 * `ctrl+k ctrl+s` конфликтом НЕ считаются, их резолвер решает детерминированно)
 * и пересекающийся when.
 */
export function findConflictingBindings(entries: readonly IKeybindingEntrySnapshot[]): ReadonlySet<number> {
    const groups = new Map<string, number[]>();
    entries.forEach((entry, index) => {
        const key = serializeChord(entry.chord);
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [index]);
        else group.push(index);
    });

    const conflicting = new Set<number>();
    for (const group of groups.values()) {
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                if (whenMayOverlap(entries[group[i]].when, entries[group[j]].when)) {
                    conflicting.add(group[i]);
                    conflicting.add(group[j]);
                }
            }
        }
    }
    return conflicting;
}
