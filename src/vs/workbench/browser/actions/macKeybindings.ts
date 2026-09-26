import {
    combineWhen,
    type CommandAction,
    type KeybindingEntry,
} from "../../../platform/actions/common/commandAction.ts";
import {
    type KeybindingChord,
    parseChord,
    serializeChord,
} from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { macKeysAtLeast, type MacKeysRung, notMacKeys } from "../../../platform/keybinding/common/macKeys.ts";

/**
 * Мак-дельты дефолтных биндов — ручная половина мак-раскладки, одной таблицей.
 *
 * Механическая половина живёт при командах токеном `mod` (Ctrl на pc, Cmd на
 * `mac-cmd`, аналог `KeyMod.CtrlCmd`). Сюда — только то, где 1:1 нет: эталон
 * vscode (MIT) задаёт у команды явный `mac:` или `KeyMod.WinCtrl`-подслой.
 * Таблица читается и сверяется с эталоном целиком; слой регистрации
 * ({@link withMacKeybindings}) разворачивает её в обычные per-binding записи
 * с условием по мак-рунгу — механизм биндингов остаётся один.
 *
 * Правила (закрыты тестами `macKeybindings.test.ts`):
 *  - `from` — самый низкий рунг, где комбинация физически доезжает; выше она
 *    действует сама (наследование вверх);
 *  - не `alt+<буква>`: на немецкой/французской раскладке Option+буква даёт
 *    `@ [ ] { }`, бинд съел бы ввод символа;
 *  - не `ctrl+←/→`: их забирает Mission Control;
 *  - Cmd+C/V/X не биндим: копипаст остаётся эмулятору (решение человека);
 *  - в пределах семейства условия взаимоисключающие — `pcOnly` снимает на маке
 *    pc-бинд, чья комбинация там значит другое.
 */
export interface MacKeybindingDelta {
    readonly command: string;
    /** Комбинации pc-биндов команды (как объявлены при команде), которые на маке не действуют. */
    readonly pcOnly?: readonly string[];
    /** Мак-бинды: с какого рунга действуют. */
    readonly mac?: readonly { readonly keys: string; readonly from: MacKeysRung }[];
}

export const MAC_KEYBINDING_DELTAS: readonly MacKeybindingDelta[] = [
    // ─── Слова: Option+←/→ (Ctrl+стрелки — Mission Control) ───
    { command: "cursorWordLeft", pcOnly: ["ctrl+left"], mac: [{ keys: "alt+left", from: "legacy" }] },
    { command: "cursorWordRight", pcOnly: ["ctrl+right"], mac: [{ keys: "alt+right", from: "legacy" }] },
    {
        command: "cursorWordLeftSelect",
        pcOnly: ["ctrl+shift+left"],
        mac: [{ keys: "alt+shift+left", from: "legacy" }],
    },
    {
        command: "cursorWordRightSelect",
        pcOnly: ["ctrl+shift+right"],
        mac: [{ keys: "alt+shift+right", from: "legacy" }],
    },
    { command: "input.cursorWordLeft", pcOnly: ["ctrl+left"], mac: [{ keys: "alt+left", from: "legacy" }] },
    { command: "input.cursorWordRight", pcOnly: ["ctrl+right"], mac: [{ keys: "alt+right", from: "legacy" }] },
    { command: "deleteWordLeft", pcOnly: ["ctrl+backspace"], mac: [{ keys: "alt+backspace", from: "legacy" }] },
    { command: "deleteWordRight", pcOnly: ["ctrl+delete"], mac: [{ keys: "alt+delete", from: "legacy" }] },
    { command: "input.deleteWordLeft", pcOnly: ["ctrl+backspace"], mac: [{ keys: "alt+backspace", from: "legacy" }] },
    { command: "input.deleteWordRight", pcOnly: ["ctrl+delete"], mac: [{ keys: "alt+delete", from: "legacy" }] },

    // ─── Строка: Ctrl+A/E (WinCtrl-подслой; Home/End в мак-терминалах скроллят буфер) ───
    { command: "cursorLineStart", mac: [{ keys: "ctrl+a", from: "legacy" }] },
    { command: "cursorLineEnd", mac: [{ keys: "ctrl+e", from: "legacy" }] },
    // Ctrl+A на маке — начало строки, поэтому «выделить всё» — только Cmd+A.
    { command: "editor.action.selectAll", pcOnly: ["ctrl+a"], mac: [{ keys: "meta+a", from: "cmd" }] },
    { command: "cursorHome", mac: [{ keys: "meta+left", from: "cmd" }] },
    { command: "cursorEnd", mac: [{ keys: "meta+right", from: "cmd" }] },
    { command: "cursorHomeSelect", mac: [{ keys: "meta+shift+left", from: "cmd" }] },
    { command: "cursorEndSelect", mac: [{ keys: "meta+shift+right", from: "cmd" }] },
    { command: "deleteAllLeft", mac: [{ keys: "meta+backspace", from: "cmd" }] },

    // ─── Документ: Cmd+↑/↓ вместо Ctrl+Home/End ───
    { command: "cursorTop", mac: [{ keys: "meta+up", from: "cmd" }] },
    { command: "cursorBottom", mac: [{ keys: "meta+down", from: "cmd" }] },
    { command: "cursorTopSelect", mac: [{ keys: "meta+shift+up", from: "cmd" }] },
    { command: "cursorBottomSelect", mac: [{ keys: "meta+shift+down", from: "cmd" }] },

    // ─── Вкладки: Cmd+Option+→/← и Cmd+Shift+]/[ (Ctrl+PageDown/Up остаются) ───
    {
        command: "workbench.action.nextEditor",
        mac: [
            { keys: "meta+alt+right", from: "cmd" },
            { keys: "meta+shift+]", from: "cmd" },
        ],
    },
    {
        command: "workbench.action.previousEditor",
        mac: [
            { keys: "meta+alt+left", from: "cmd" },
            { keys: "meta+shift+[", from: "cmd" },
        ],
    },
];

const DELTAS_BY_COMMAND: ReadonlyMap<string, MacKeybindingDelta> = new Map(
    MAC_KEYBINDING_DELTAS.map((delta) => [delta.command, delta]),
);

function toConditional(entry: KeybindingEntry): { keys: KeybindingChord; when: string | undefined } {
    if (!Array.isArray(entry) && "keys" in entry) {
        return { keys: Array.isArray(entry.keys) ? entry.keys : [entry.keys], when: entry.when };
    }
    return { keys: Array.isArray(entry) ? entry : [entry], when: undefined };
}

/**
 * Накладывает мак-дельту команды на её бинды: pc-бинды из `pcOnly` получают
 * условие «не мак», мак-бинды добавляются с условием «рунг ≥ from». Команда без
 * дельты возвращается как есть. `pcOnly`, не найденный среди биндов команды, —
 * ошибка таблицы, а не тихий no-op.
 */
export function withMacKeybindings(
    action: CommandAction,
    deltas: ReadonlyMap<string, MacKeybindingDelta> = DELTAS_BY_COMMAND,
): CommandAction {
    const delta = deltas.get(action.id);
    if (delta === undefined) return action;

    const declared = [action.keybinding, ...(action.keybindings ?? [])]
        .filter((entry) => entry !== undefined)
        .map(toConditional);
    const pcOnly = new Set(delta.pcOnly);
    const bindings: KeybindingEntry[] = declared.map(({ keys, when }) => {
        const spec = serializeChord(keys);
        if (!pcOnly.has(spec)) return { keys, when };
        pcOnly.delete(spec);
        return { keys, when: combineWhen(when, notMacKeys()) };
    });
    if (pcOnly.size > 0) {
        throw new Error(`${action.id}: pcOnly ${[...pcOnly].join(", ")} не найден среди биндов команды`);
    }
    for (const { keys, from } of delta.mac ?? []) {
        bindings.push({ keys: parseChord(keys), when: macKeysAtLeast(from) });
    }
    const { keybinding: _primary, ...rest } = action;
    return { ...rest, keybindings: bindings };
}
