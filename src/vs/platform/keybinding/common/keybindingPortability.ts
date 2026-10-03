import type { Keybinding, KeybindingChord } from "./keybindingRegistry.ts";

/**
 * Эвристика терминальной переносимости комбинации: доедет ли она на
 * legacy-терминале (без Kitty keyboard protocol / CSI-u), где часть сочетаний
 * физически неразличима в байтовом потоке.
 *
 * Таблица калибрована по разбору ввода движка (`@tuidom/core`, `input/tokenize`
 * и `input/convertToken`): «доезжает» значит «из байтов legacy-потока
 * получается ровно это событие», а не «терминал что-то прислал». Отсюда
 * неочевидные записи:
 *  - Ctrl+Space доезжает — это NUL (0x00), отдельный байт;
 *  - Shift+Tab доезжает — это CSI Z (backtab), а Ctrl+Tab нет: он сам 0x09;
 *  - Shift с печатным символом не доезжает НИКОГДА: регистр в поток не
 *    попадает (Ctrl+Shift+F сводится к control-байту Ctrl+F, Alt+Shift+F — к
 *    `ESC F`, а флаг shiftKey событию при этом не выставляется).
 *
 * Эвристика по-прежнему про общий случай, а не про конкретный эмулятор, и
 * используется в двух местах: предупреждение рекордера биндов и гейт
 * достижимости (`keybindingReachability.test.ts`). Таблица зафиксирована тестом.
 */
export function requiresExtendedKeys(chord: KeybindingChord): boolean {
    return chord.some(partRequiresExtendedKeys);
}

/** Одиночный печатный символ: буква, цифра, знак. У `Enter`/`F5`/`ArrowUp` длина больше. */
const PRINTABLE_KEY = /^[\x20-\x7e]$/;

// `ESC [` — вводитель CSI, `ESC ]` — OSC: разбор ввода уйдёт в парсер
// последовательности, а не отдаст Alt+<символ>.
const ESC_PREFIX_KEYS = new Set(["[", "]"]);

function partRequiresExtendedKeys(part: Keybinding): boolean {
    // Meta в legacy-потоке не кодируется вовсе.
    if (part.metaKey) return true;
    // Shift + печатный символ: Shift неотличим (см. шапку).
    if (part.shiftKey && PRINTABLE_KEY.test(part.key)) return true;
    // Ctrl+Enter === Enter (0x0d), Ctrl+Backspace === Ctrl+H (0x08),
    // Shift с ними не кодируется вовсе.
    if ((part.key === "Enter" || part.key === "Backspace") && (part.ctrlKey || part.shiftKey)) return true;
    // Ctrl+Tab === Tab (0x09); Alt+Tab — это `ESC 0x09`, то есть Ctrl+Alt+I.
    if (part.key === "Tab" && (part.ctrlKey || part.altKey)) return true;
    // Alt+[ / Alt+] — вводители CSI/OSC.
    return part.altKey && ESC_PREFIX_KEYS.has(part.key);
}
