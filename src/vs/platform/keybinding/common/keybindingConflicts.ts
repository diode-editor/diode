import { deserializeWhen, serializeWhen } from "../../contextkey/common/contextKeyExpr.ts";

import type { IKeybindingEntrySnapshot } from "./keybindingRegistry.ts";
import { serializeChord } from "./keybindingRegistry.ts";

// Highlighting only: the resolver knows nothing of conflicts, the last registered entry wins.

/**
 * A SAT simplification: a missing when overlaps with any, others compare by their canonical
 * parsed form, unparsed ones as strings. False negatives are possible (`tier == 'kitty'`
 * vs `tier != 'legacy'`): a helper filter, not a guarantee.
 */
export function whenMayOverlap(a: string | undefined, b: string | undefined): boolean {
    if (a === undefined || b === undefined) return true;
    return canonicalWhen(a) === canonicalWhen(b);
}

function canonicalWhen(when: string): string {
    const expr = deserializeWhen(when);
    return expr === undefined ? when.trim() : serializeWhen(expr);
}

/** Chord prefixes (`ctrl+k` vs `ctrl+k ctrl+s`) are not conflicts: the resolver settles them deterministically. */
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
        // Stryker disable next-line EqualityOperator: `<=` adds an extra iteration i=length, but its inner loop (j=i+1>length) is empty, same result.
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
