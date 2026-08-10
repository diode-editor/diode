/**
 * Convert a human-readable key name (DSL) to the raw terminal escape sequence.
 * Inverse of parseInput — used in tests for the DSL:
 *   serializeKey('a')              → 'a'
 *   serializeKey('Ctrl+C')         → '\x03'
 *   serializeKey('Enter')          → '\r'
 *   serializeKey('ArrowUp')        → '\x1b[A'
 *   serializeKey('Ctrl+ArrowUp')   → '\x1b[1;5A'
 *   serializeKey('F5')             → '\x1b[15~'
 *   serializeKey('Alt+a')          → '\x1ba'
 *
 * Supports modifier prefixes: Ctrl+, Shift+, Alt+, Meta+ (combinable).
 */

/** Simple special keys (no modifiers, no CSI) */
const simpleSpecialKeys: Record<string, string> = {
    Enter: "\x0d",
    Tab: "\x09",
    Backspace: "\x7f",
    Escape: "\x1b",
    Space: " ",
};

/** Keys using CSI <letter> format (also used for Ctrl/Shift/Alt variants) */
const csiLetterKeys: Record<string, string> = {
    ArrowUp: "A",
    ArrowDown: "B",
    ArrowRight: "C",
    ArrowLeft: "D",
    Home: "H",
    End: "F",
    F1: "P",
    F2: "Q",
    F3: "R",
    F4: "S",
};

/** Keys using SS3 format (no-modifier variant of F1–F4 and cursor keys in app mode) */
const ss3Keys: Record<string, string> = {
    F1: "P",
    F2: "Q",
    F3: "R",
    F4: "S",
};

/** Keys using CSI <num>~ format */
const csiTildeKeys: Record<string, number> = {
    Insert: 2,
    Delete: 3,
    PageUp: 5,
    PageDown: 6,
    F5: 15,
    F6: 17,
    F7: 18,
    F8: 19,
    F9: 20,
    F10: 21,
    F11: 23,
    F12: 24,
};

function encodeModifier(ctrl: boolean, shift: boolean, alt: boolean, meta: boolean): number {
    let mod = 1;
    if (shift) mod += 1;
    if (alt) mod += 2;
    if (ctrl) mod += 4;
    if (meta) mod += 8;
    return mod;
}

export function serializeKey(name: string): string {
    // Parse modifier prefixes: "Ctrl+Shift+ArrowUp" → modifiers + "ArrowUp"
    let ctrl = false;
    let shift = false;
    let alt = false;
    let meta = false;
    let remaining = name;

    const modPattern = /^(Ctrl|Shift|Alt|Meta)\+/;
    let match = modPattern.exec(remaining);
    while (match) {
        const mod = match[1];
        if (mod === "Ctrl") ctrl = true;
        else if (mod === "Shift") shift = true;
        /* v8 ignore start -- the modifier regex only ever captures Ctrl|Shift|Alt|Meta, so the final "none matched" fall-through (no else clause) is unreachable; v8 attributes that phantom branch to these chained else-ifs */ else if (
            mod === "Alt"
        )
            alt = true;
        else if (mod === "Meta") meta = true;
        /* v8 ignore stop */
        remaining = remaining.slice(match[0].length);
        match = modPattern.exec(remaining);
    }

    const hasModifiers = ctrl || shift || alt || meta;

    // Simple special keys without modifiers
    if (!hasModifiers && remaining in simpleSpecialKeys) {
        return simpleSpecialKeys[remaining];
    }

    // Shift+Tab → CSI Z (reverse tab / backtab)
    if (shift && !ctrl && !alt && !meta && remaining === "Tab") {
        return "\x1b[Z";
    }

    // Tab with modifiers in Kitty CSI-u form: CSI 9;{mod}:1u
    if (remaining === "Tab" && hasModifiers) {
        const mod = encodeModifier(ctrl, shift, alt, meta);
        return `\x1b[9;${mod.toString()}:1u`;
    }

    // Enter with modifiers in Kitty CSI-u form: CSI 13;{mod}u (Ctrl+Enter = commit).
    if (remaining === "Enter" && hasModifiers) {
        const mod = encodeModifier(ctrl, shift, alt, meta);
        return `\x1b[13;${mod.toString()}u`;
    }

    // Ctrl+Space → NUL: именно так его шлёт терминал (см. tokenize.ts, 0x00).
    if (ctrl && !shift && !alt && !meta && remaining === "Space") {
        return "\x00";
    }

    // Ctrl+letter → control character (0x01–0x1a)
    if (ctrl && !shift && !alt && !meta && remaining.length === 1 && /[a-zA-Z]/.test(remaining)) {
        const code = remaining.toUpperCase().charCodeAt(0) - 0x40;
        return String.fromCharCode(code);
    }

    // Alt+single character → ESC prefix
    if (alt && !ctrl && !shift && !meta && remaining.length === 1) {
        return `\x1b${remaining}`;
    }

    // CSI letter keys (cursor keys, F1–F4)
    if (remaining in csiLetterKeys) {
        const letter = csiLetterKeys[remaining];
        if (!hasModifiers) {
            // F1–F4 without modifiers use SS3 format
            if (remaining in ss3Keys) {
                return `\x1bO${ss3Keys[remaining]}`;
            }
            return `\x1b[${letter}`;
        }
        const mod = encodeModifier(ctrl, shift, alt, meta);
        return `\x1b[1;${mod.toString()}${letter}`;
    }

    // Kitty functional keys without legacy escape form (CSI-u codepoint)
    if (remaining === "ContextMenu") {
        if (!hasModifiers) {
            return "\x1b[57363u";
        }
        const mod = encodeModifier(ctrl, shift, alt, meta);
        return `\x1b[57363;${mod.toString()}u`;
    }

    // CSI tilde keys (Insert, Delete, PageUp, PageDown, F5–F12)
    if (remaining in csiTildeKeys) {
        const num = csiTildeKeys[remaining];
        if (!hasModifiers) {
            return `\x1b[${num.toString()}~`;
        }
        const mod = encodeModifier(ctrl, shift, alt, meta);
        return `\x1b[${num.toString()};${mod.toString()}~`;
    }

    // Single printable character (no modifiers)
    if (!hasModifiers && remaining.length === 1) {
        return remaining;
    }

    throw new Error(`serializeKey: unknown key name "${name}". Add it to the mapping.`);
}
