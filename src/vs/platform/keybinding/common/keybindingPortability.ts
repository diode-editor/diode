import type { Keybinding, KeybindingChord } from "./keybindingRegistry.ts";

/**
 * Эвристика терминальной переносимости комбинации: доедет ли она на
 * legacy-терминале (без Kitty keyboard protocol / CSI-u), где часть сочетаний
 * физически неразличима в байтовом потоке.
 *
 * Честно неполная — это предупреждение рекордера, а не гейт: точный ответ
 * зависит от конкретного эмулятора. Ложь в обе стороны допустима; таблица
 * зафиксирована тестом.
 */
export function requiresExtendedKeys(chord: KeybindingChord): boolean {
    return chord.some(partRequiresExtendedKeys);
}

// Клавиши, чьи управляющие байты в legacy заняты самим символом: Ctrl+M === Enter,
// Ctrl+I === Tab, а Shift с ними вовсе не кодируется.
const CONTROL_ALIASED_KEYS = new Set(["Enter", "Tab", " ", "Backspace"]);

function partRequiresExtendedKeys(part: Keybinding): boolean {
    // Meta в legacy-потоке не кодируется вовсе.
    if (part.metaKey) return true;
    // Ctrl+Shift+<буква/цифра>: control-байт один на регистр — Shift неотличим.
    if (part.ctrlKey && part.shiftKey && /^[a-z0-9]$/i.test(part.key)) return true;
    // Ctrl/Shift с Enter/Tab/Space/Backspace: alias на управляющий символ.
    if (CONTROL_ALIASED_KEYS.has(part.key) && (part.ctrlKey || part.shiftKey)) return true;
    return false;
}
