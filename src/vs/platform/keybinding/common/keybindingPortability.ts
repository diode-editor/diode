import type { Keybinding, KeybindingChord } from "./keybindingRegistry.ts";

/**
 * Whether a chord gets through on a legacy terminal (no CSI-u). Calibrated against the input parser
 * of `@tuidom/core`: "gets through" means the bytes decode to exactly this event. Non-obvious: Ctrl+Space
 * gets through (NUL), Shift+Tab does (CSI Z), Ctrl+Tab doesn't (0x09); Shift with a printable char
 * never does: case doesn't reach the stream, Ctrl+Shift+F collapses to Ctrl+F.
 */
export function requiresExtendedKeys(chord: KeybindingChord): boolean {
    return chord.some(partRequiresExtendedKeys);
}

const PRINTABLE_KEY = /^[\x20-\x7e]$/;

// `ESC [` introduces CSI, `ESC ]` OSC: the input parser goes into the sequence
// parser instead of yielding Alt+<char>.
const ESC_PREFIX_KEYS = new Set(["[", "]"]);

function partRequiresExtendedKeys(part: Keybinding): boolean {
    // Meta isn't encoded in the legacy stream at all.
    if (part.metaKey) return true;
    if (part.shiftKey && PRINTABLE_KEY.test(part.key)) return true;
    // Ctrl+Enter === Enter (0x0d), Ctrl+Backspace === Ctrl+H (0x08),
    // Shift with them isn't encoded at all.
    if ((part.key === "Enter" || part.key === "Backspace") && (part.ctrlKey || part.shiftKey)) return true;
    // Ctrl+Tab === Tab (0x09); Alt+Tab is `ESC 0x09`, i.e. Ctrl+Alt+I.
    if (part.key === "Tab" && (part.ctrlKey || part.altKey)) return true;
    return part.altKey && ESC_PREFIX_KEYS.has(part.key);
}
