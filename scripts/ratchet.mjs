// Per-file ratchet shared by the check-* scripts: a baseline maps file → allowed count,
// a file missing from it is held to zero, and the baseline is only ever lowered.

export function compare(baseline, counts) {
    const over = [];
    const below = [];
    for (const file of new Set([...Object.keys(baseline), ...Object.keys(counts)])) {
        const count = counts[file] ?? 0;
        const allowed = baseline[file] ?? 0;
        if (count > allowed) over.push({ file, count, allowed });
        else if (count < allowed) below.push({ file, count, allowed });
    }
    return { over, below };
}

/** Lowered baseline: min of old and current, zeros and vanished files dropped, never raised. */
export function lowered(baseline, counts) {
    const next = {};
    for (const file of Object.keys(baseline).sort()) {
        const count = Math.min(baseline[file], counts[file] ?? 0);
        if (count > 0) next[file] = count;
    }
    return next;
}
