import type { Keybinding, KeybindingChord } from "./keybindingRegistry.ts";

/**
 * Доедет ли комбинация на legacy-терминале (без CSI-u). Калибровано по разбору ввода
 * `@tuidom/core`: «доезжает» = из байтов получается ровно это событие. Неочевидное: Ctrl+Space
 * доезжает (NUL), Shift+Tab — да (CSI Z), Ctrl+Tab — нет (0x09); Shift с печатным символом —
 * никогда: регистр в поток не попадает, Ctrl+Shift+F сводится к Ctrl+F.
 */
export function requiresExtendedKeys(chord: KeybindingChord): boolean {
    return chord.some(partRequiresExtendedKeys);
}

const PRINTABLE_KEY = /^[\x20-\x7e]$/;

// `ESC [` — вводитель CSI, `ESC ]` — OSC: разбор ввода уйдёт в парсер
// последовательности, а не отдаст Alt+<символ>.
const ESC_PREFIX_KEYS = new Set(["[", "]"]);

function partRequiresExtendedKeys(part: Keybinding): boolean {
    // Meta в legacy-потоке не кодируется вовсе.
    if (part.metaKey) return true;
    if (part.shiftKey && PRINTABLE_KEY.test(part.key)) return true;
    // Ctrl+Enter === Enter (0x0d), Ctrl+Backspace === Ctrl+H (0x08),
    // Shift с ними не кодируется вовсе.
    if ((part.key === "Enter" || part.key === "Backspace") && (part.ctrlKey || part.shiftKey)) return true;
    // Ctrl+Tab === Tab (0x09); Alt+Tab — это `ESC 0x09`, то есть Ctrl+Alt+I.
    if (part.key === "Tab" && (part.ctrlKey || part.altKey)) return true;
    return part.altKey && ESC_PREFIX_KEYS.has(part.key);
}
