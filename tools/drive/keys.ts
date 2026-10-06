/**
 * Проверка имён клавиш DSL `TUIDom.sendKey` (`serializeKey` движка) ДО
 * отправки. Движок незнакомое имя не отвергает: `"Down"` уезжает в редактор
 * как набор четырёх букв `D o w n`, и ловится это только по испорченному
 * буферу. Здесь незнакомое имя — ошибка с подсказкой.
 */

const MODIFIERS = ["Ctrl", "Shift", "Alt", "Meta"] as const;

const NAMED_KEYS = new Set([
    "Enter",
    "Tab",
    "Backspace",
    "Escape",
    "Space",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "Insert",
    "Delete",
    "PageUp",
    "PageDown",
    "ContextMenu",
    ...Array.from({ length: 12 }, (_, i) => `F${String(i + 1)}`),
]);

/** Частые промахи → правильное имя. */
const ALIASES: Readonly<Partial<Record<string, string>>> = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    esc: "Escape",
    return: "Enter",
    del: "Delete",
    pgup: "PageUp",
    pgdn: "PageDown",
    pagedown: "PageDown",
    pageup: "PageUp",
    control: "Ctrl",
    cmd: "Meta",
    option: "Alt",
    bs: "Backspace",
};

/** Нормализует регистр модификаторов и проверяет базовую клавишу. Бросает с подсказкой. */
export function validateKey(name: string): string {
    const parts = name.split("+");
    // `Ctrl++` — плюс как клавиша: последний сегмент пустой.
    if (name.endsWith("++")) parts.splice(parts.length - 2, 2, "+");
    const base = parts.pop() ?? "";
    const mods = parts.map((m) => {
        const canonical = MODIFIERS.find((x) => x.toLowerCase() === m.toLowerCase()) ?? ALIASES[m.toLowerCase()];
        if (canonical === undefined || !(MODIFIERS as readonly string[]).includes(canonical)) {
            throw new Error(
                `неизвестный модификатор ${JSON.stringify(m)} в ${JSON.stringify(name)} (Ctrl, Shift, Alt, Meta)`,
            );
        }
        return canonical;
    });
    if (Array.from(base).length === 1) return [...mods, base].join("+");
    const named = [...NAMED_KEYS].find((k) => k.toLowerCase() === base.toLowerCase());
    if (named !== undefined) return [...mods, named].join("+");
    const alias = ALIASES[base.toLowerCase()];
    const hint = alias !== undefined ? ` — может, ${[...mods, alias].join("+")}?` : "";
    throw new Error(
        `неизвестная клавиша ${JSON.stringify(name)}${hint} Имена: ${[...NAMED_KEYS].slice(0, 16).join(", ")}, F1–F12 или один символ; текст — командой type/paste`,
    );
}

/** Символ набора → имя клавиши DSL (`type` идёт посимвольно, как пользователь). */
export function charToKey(ch: string): string {
    if (ch === " ") return "Space";
    if (ch === "\n" || ch === "\r") return "Enter";
    if (ch === "\t") return "Tab";
    return ch;
}
