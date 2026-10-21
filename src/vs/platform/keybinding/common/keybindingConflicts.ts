import { deserializeWhen, serializeWhen } from "../../contextkey/common/contextKeyExpr.ts";

import type { IKeybindingEntrySnapshot } from "./keybindingRegistry.ts";
import { serializeChord } from "./keybindingRegistry.ts";

// Только подсветка: резолвер конфликтов не знает — побеждает последняя зарегистрированная.

/**
 * Упрощение SAT: отсутствующий when пересекается с любым, прочие сравниваются канонической
 * записью разбора, неразобранные — строкой. Ложноотрицательные возможны (`tier == 'kitty'`
 * против `tier != 'legacy'`) — фильтр-помощник, не гарантия.
 */
export function whenMayOverlap(a: string | undefined, b: string | undefined): boolean {
    if (a === undefined || b === undefined) return true;
    return canonicalWhen(a) === canonicalWhen(b);
}

function canonicalWhen(when: string): string {
    const expr = deserializeWhen(when);
    return expr === undefined ? when.trim() : serializeWhen(expr);
}

/** Chord-префиксы (`ctrl+k` против `ctrl+k ctrl+s`) конфликтом не считаются: их резолвер решает детерминированно. */
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
        // Stryker disable next-line EqualityOperator: `<=` даёт лишнюю итерацию i=length, но её внутренний цикл (j=i+1>length) пуст — результат тот же.
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
