/**
 * The engine does not reject an unknown key name: `"Down"` reaches the editor as four
 * letters and shows up only as a corrupted buffer, hence the check before sending.
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

export function validateKey(name: string): string {
    const parts = name.split("+");
    // `Ctrl++`: the key is plus, so the last segment is empty.
    if (name.endsWith("++")) parts.splice(parts.length - 2, 2, "+");
    const base = parts.pop() ?? "";
    const mods = parts.map((m) => {
        const canonical = MODIFIERS.find((x) => x.toLowerCase() === m.toLowerCase()) ?? ALIASES[m.toLowerCase()];
        if (canonical === undefined || !(MODIFIERS as readonly string[]).includes(canonical)) {
            throw new Error(
                `unknown modifier ${JSON.stringify(m)} in ${JSON.stringify(name)} (Ctrl, Shift, Alt, Meta)`,
            );
        }
        return canonical;
    });
    if (Array.from(base).length === 1) return [...mods, base].join("+");
    const named = [...NAMED_KEYS].find((k) => k.toLowerCase() === base.toLowerCase());
    if (named !== undefined) return [...mods, named].join("+");
    const alias = ALIASES[base.toLowerCase()];
    const hint = alias !== undefined ? ` — did you mean ${[...mods, alias].join("+")}?` : "";
    throw new Error(
        `unknown key ${JSON.stringify(name)}${hint} Names: ${[...NAMED_KEYS].slice(0, 16).join(", ")}, F1–F12 or a single char; for text use type/paste`,
    );
}

export function charToKey(ch: string): string {
    if (ch === " ") return "Space";
    if (ch === "\n" || ch === "\r") return "Enter";
    if (ch === "\t") return "Tab";
    return ch;
}
